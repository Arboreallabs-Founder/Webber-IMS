-- ============================================================
-- 0096 — A GRN line no longer creates a lot (and QR) or counts toward
-- PO received quantity until the GRN itself is fully signed.
--
-- Previously, inserting a grn_lines row created stock immediately and
-- unconditionally: the AFTER INSERT trigger grn_line_after_insert() created
-- the inventory_lots row (and its lot_code / QR), regardless of whether
-- anyone had signed the GRN. Signing a GRN had "no status effect" (see the
-- comment on sign_grn in migration 0072b) beyond gating the print page, and
-- the print page itself is grandfathered for GRNs predating the signature
-- feature — so in practice signatures never blocked anything but printing.
--
-- Per explicit request: material a receiver logs is not counted as
-- inventory, and no QR is generated for it, until the GRN carrying it has
-- every required signature. Once the last signature lands, every line still
-- pending on that GRN is processed in one go.
-- ============================================================

alter table public.grn_lines add column processed_at timestamptz;
-- Piece dimensions used to be patched onto the lot by the app right after
-- insert, which assumed the lot already existed. Under deferred processing
-- it might not exist yet, so they are captured on the grn_lines row itself
-- and carried onto the lot whenever it is actually created — now, or later.
alter table public.grn_lines add column piece_count numeric;
alter table public.grn_lines add column piece_length numeric;
alter table public.grn_lines add column piece_width numeric;
alter table public.grn_lines add column piece_weight numeric;

-- Every existing grn_line already has its lot and its PO rollup applied —
-- backfilling processed_at = created_at makes them "already processed"
-- under the new rule, so nothing about existing stock or existing GRNs
-- changes retroactively. The gate only bites for lines inserted from here on.
update public.grn_lines set processed_at = created_at where processed_at is null;

-- ---- the lot-creation body, extracted so it can run either immediately
-- (AFTER INSERT, when the GRN is already fully signed) or later in bulk
-- (once the last required signature lands) ----------------------------
create or replace function public.process_grn_line(p_grn_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec      public.grn_lines;
  v_track  public.tracking_mode;
  v_is_ser boolean;
  v_is_jw  boolean;
  v_stage  public.jw_stage;
  v_vendor uuid;
  v_lot    uuid;
  v_code   text;
  v_status public.lot_status;
  v_n      int;
  i        int;
  v_jwline     public.job_work_lines;
  v_last       uuid;
  v_total_sent numeric;
  v_total_ret  numeric;
begin
  -- Locked + idempotent: safe to call from the insert trigger AND from the
  -- bulk sweep that fires when a GRN's last signature lands, without ever
  -- double-creating a lot for the same line.
  select * into rec from public.grn_lines where id = p_grn_line_id for update;
  if not found or rec.processed_at is not null then
    return;
  end if;

  select tracking_mode, is_serialized, is_job_work
    into v_track, v_is_ser, v_is_jw
    from public.components where id = rec.component_id;
  v_stage  := case when coalesce(v_is_jw, false) then 'raw'::public.jw_stage else null end;
  v_vendor := (select vendor_id from public.grns where id = rec.grn_id);
  v_status := case when rec.project_id is not null then 'issued'::public.lot_status else 'open'::public.lot_status end;

  -- (0) Job-work completed-goods receipt: one or more lots produced from a
  -- specific job_work_lines row, parented to the raw lot that was consumed.
  if rec.jw_line_id is not null then
    select * into v_jwline from public.job_work_lines where id = rec.jw_line_id;

    if v_track = 'item' and rec.qty_received = floor(rec.qty_received)
       and rec.qty_received > 0 and rec.qty_received <= 1000 then
      v_n := rec.qty_received::int;
    else
      v_n := 1;
    end if;

    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id, parent_lot_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage,
        container_no, created_by)
      values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id, v_jwline.raw_lot_id,
        0, case when v_n > 1 then 1 else rec.qty_received end, rec.unit_cost,
        case when v_track = 'item' then true else coalesce(v_is_ser, false) end,
        v_status, 'completed'::public.jw_stage,
        case when v_track = 'box' then v_code else null end, rec.created_by)
      returning id into v_lot;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, rec.component_id, 'receipt', case when v_n > 1 then 1 else rec.qty_received end, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
      v_last := v_lot;
    end loop;

    update public.job_work_lines
       set qty_returned = coalesce(qty_returned, 0) + rec.qty_received,
           completed_lot_id = v_last
     where id = rec.jw_line_id;

    select coalesce(sum(qty_sent), 0), coalesce(sum(qty_returned), 0)
      into v_total_sent, v_total_ret
      from public.job_work_lines where jw_order_id = v_jwline.jw_order_id;
    update public.job_work_orders
       set status = case when v_total_ret >= v_total_sent then 'received' else 'partial' end
     where id = v_jwline.jw_order_id;

  -- (a) Add-to-existing-box: no new lot, just a receipt movement into the chosen box.
  elsif rec.target_lot_id is not null then
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (rec.target_lot_id, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
      'grn', rec.id, rec.created_by, rec.created_by);

  -- (b) Item tracking: one lot (one QR) per physical piece.
  elsif v_track = 'item' and rec.qty_received = floor(rec.qty_received)
     and rec.qty_received > 0 and rec.qty_received <= 1000 then
    v_n := rec.qty_received::int;
    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, created_by)
      values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id,
        0, 1, rec.unit_cost, true, v_status, v_stage, rec.created_by)
      returning id into v_lot;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, rec.component_id, 'receipt', 1, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
    end loop;

  -- (c) Box / bulk (default): one lot for the whole receipt.
  else
    v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    insert into public.inventory_lots(
      lot_code, component_id, grn_line_id, vendor_id, project_id,
      qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage,
      container_no, piece_count, piece_length, piece_width, piece_weight, created_by)
    values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id,
      0, rec.qty_received, rec.unit_cost, coalesce(v_is_ser, false), v_status, v_stage,
      case when v_track = 'box' then v_code else null end,
      rec.piece_count, rec.piece_length, rec.piece_width, rec.piece_weight, rec.created_by)
    returning id into v_lot;
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (v_lot, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
      'grn', rec.id, rec.created_by, rec.created_by);
  end if;

  update public.grn_lines set processed_at = now() where id = rec.id;
end;
$$;
revoke all on function public.process_grn_line(uuid) from public, anon;
grant execute on function public.process_grn_line(uuid) to authenticated;

-- ---- AFTER INSERT: process now if the GRN is already fully signed, else leave pending ----
create or replace function public.grn_line_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.document_fully_signed('grn', NEW.grn_id) then
    perform public.process_grn_line(NEW.id);
  end if;
  return NEW;
end;
$$;

-- ---- BEFORE INSERT: over-receipt guard now sums grn_lines directly rather
-- than trusting po_lines.qty_received, which only reflects processed lines
-- and would otherwise lag behind while a GRN is still unsigned — letting two
-- different pending GRNs together over-receipt the same PO line undetected
-- until both eventually got signed. ------------------------------------
create or replace function public.grn_line_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ord  numeric;
  v_recv numeric;
begin
  if new.po_line_id is null and new.project_id is null then new.is_untagged := true; end if;

  if new.po_line_id is not null and new.jw_line_id is null then
    select qty_ordered into v_ord from public.po_lines where id = new.po_line_id;
    select coalesce(sum(qty_received), 0) into v_recv
      from public.grn_lines where po_line_id = new.po_line_id;

    if v_ord is not null and v_recv + new.qty_received > v_ord + 1e-6 then
      raise exception
        'Over-receipt blocked: PO line has % remaining (ordered %, already received %); this GRN line adds %.',
        (v_ord - v_recv), v_ord, v_recv, new.qty_received
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---- PO rollup now only counts processed lines, so a PO line's received
-- quantity / status reflect stock that actually exists, not material still
-- sitting in an unsigned GRN. --------------------------------------------
create or replace function public.rollup_po_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poline uuid;
  v_recv   numeric;
  v_ord    numeric;
  v_po     uuid;
  v_status public.po_line_status;
begin
  v_poline := coalesce(new.po_line_id, old.po_line_id);
  if v_poline is null then return coalesce(new, old); end if;

  select coalesce(sum(qty_received), 0) into v_recv
    from public.grn_lines where po_line_id = v_poline and processed_at is not null;
  select qty_ordered, po_id into v_ord, v_po from public.po_lines where id = v_poline;

  v_status := (case
    when v_recv <= 0 then 'pending'
    when v_recv >= v_ord then 'received'
    else 'partial'
  end)::public.po_line_status;

  update public.po_lines set qty_received = v_recv, line_status = v_status where id = v_poline;
  perform public.recompute_po_status(v_po);
  return coalesce(new, old);
end;
$$;

-- ---- the single choke point every GRN/PO/job-work signature passes
-- through (sign_*, backfill_signature, and approve_irn's own call into it)
-- — the moment a GRN becomes fully signed here, every line still waiting on
-- it is processed in one sweep. -----------------------------------------
create or replace function public._record_signature(p_document_type text, p_document_id uuid, p_signature_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_img text;
  v_creator uuid;
  v_link text;
  v_type_label text;
  v_signed_slots smallint[];
  v_required smallint[];
  v_slot smallint;
  v_approver uuid;
  v_fully boolean;
  v_next_slot smallint;
  v_next_user uuid;
begin
  select image_data_url into v_img from public.signatures where id = p_signature_id and user_id = p_actor;
  if not found then
    return jsonb_build_object('error', 'Signature not found.');
  end if;

  if p_document_type = 'po' then
    select created_by into v_creator from public.purchase_orders where id = p_document_id;
    v_link := '/purchase-orders/' || p_document_id; v_type_label := 'purchase order';
  elsif p_document_type = 'grn' then
    select created_by into v_creator from public.grns where id = p_document_id;
    v_link := '/grn/' || p_document_id; v_type_label := 'GRN';
  elsif p_document_type = 'job_work' then
    select created_by into v_creator from public.job_work_orders where id = p_document_id;
    v_link := '/job-work/' || p_document_id; v_type_label := 'job-work order';
  else
    return jsonb_build_object('error', 'Unknown document type.');
  end if;
  if v_creator is null then
    return jsonb_build_object('error', 'Document not found.');
  end if;

  select coalesce(array_agg(slot), array[]::smallint[]) into v_signed_slots
    from public.document_signatures where document_type = p_document_type and document_id = p_document_id;

  select array(
    select distinct s from unnest(
      array[1::smallint] ||
      coalesce((select array_agg(approver_order) from public.approval_rights where document_type = p_document_type), array[]::smallint[])
    ) as s order by s
  ) into v_required;

  select min(s) into v_slot from unnest(v_required) as s where s <> all(v_signed_slots);
  if v_slot is null then
    return jsonb_build_object('error', 'This document is already fully signed.');
  end if;

  if v_slot = 1 then
    if p_actor <> v_creator then
      return jsonb_build_object('error', 'Only the document''s creator signs first.');
    end if;
  else
    select user_id into v_approver from public.approval_rights
      where document_type = p_document_type and approver_order = v_slot;
    if v_approver is null or p_actor <> v_approver then
      return jsonb_build_object('error', 'You are not the configured approver for this step.');
    end if;
  end if;

  insert into public.document_signatures(document_type, document_id, slot, user_id, signature_image_data_url)
  values (p_document_type, p_document_id, v_slot, p_actor, v_img);
  v_signed_slots := v_signed_slots || v_slot;

  -- Cascade: keep signing forward through consecutive slots still configured
  -- to this same actor (e.g. same person as 2nd and 3rd signer, or creator
  -- who's also the configured approver).
  loop
    select min(s) into v_next_slot from unnest(v_required) as s where s <> all(v_signed_slots);
    exit when v_next_slot is null;
    select user_id into v_next_user from public.approval_rights
      where document_type = p_document_type and approver_order = v_next_slot;
    exit when v_next_user is distinct from p_actor;
    insert into public.document_signatures(document_type, document_id, slot, user_id, signature_image_data_url)
    values (p_document_type, p_document_id, v_next_slot, p_actor, v_img);
    v_signed_slots := v_signed_slots || v_next_slot;
  end loop;

  select public.document_fully_signed(p_document_type, p_document_id) into v_fully;

  -- The whole point of this migration: a GRN's material only becomes stock
  -- once every required signature is in. This is that moment.
  if v_fully and p_document_type = 'grn' then
    perform public.process_grn_line(gl.id)
      from public.grn_lines gl
     where gl.grn_id = p_document_id and gl.processed_at is null;
  end if;

  if not v_fully then
    select min(s) into v_next_slot from unnest(v_required) as s where s <> all(v_signed_slots);
    select user_id into v_next_user from public.approval_rights
      where document_type = p_document_type and approver_order = v_next_slot;
    if v_next_user is not null then
      insert into public.notifications(type, message, link_path, created_by, recipient_id)
      values ('signature_required', format('Your signature is needed on a %s.', v_type_label), v_link, p_actor, v_next_user);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'fully_signed', v_fully, 'slot', v_slot);
end;
$$;

-- ---- approve_irn now carries the IRN's piece dimensions onto the
-- grn_lines row it inserts (rather than patching inventory_lots straight
-- after, which assumed the lot already existed) — process_grn_line reads
-- them from there whether it runs immediately or later. -----------------
create or replace function public.approve_irn(p_irn_id uuid, p_approver_id uuid, p_signature_id uuid, p_remarks text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.role;
  v_irn record;
  v_line_id uuid;
  v_img text;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    return jsonb_build_object('error','Only Admin / Team Lead can approve.');
  end if;

  select image_data_url into v_img from public.signatures where id = p_signature_id and user_id = auth.uid();
  if not found then
    return jsonb_build_object('error', 'Signature not found.');
  end if;

  select * into v_irn from public.irns where id = p_irn_id for update;
  if not found then return jsonb_build_object('error','IRN not found'); end if;
  if v_irn.status <> 'pending_approval' then
    return jsonb_build_object('error','IRN is not pending approval (already '||v_irn.status||')');
  end if;

  insert into public.grn_lines(grn_id, component_id, qty_received, po_line_id, project_id, unit_cost, target_lot_id, jw_line_id,
        piece_count, piece_length, piece_width, piece_weight, created_by)
  values (v_irn.grn_id, v_irn.component_id, v_irn.qty, v_irn.po_line_id, v_irn.project_id, v_irn.unit_cost, v_irn.target_lot_id, v_irn.jw_line_id,
        v_irn.piece_count, v_irn.piece_length, v_irn.piece_width, v_irn.piece_weight, v_irn.generated_by)
  returning id into v_line_id;

  update public.irns
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), grn_line_id = v_line_id,
         approval_remarks = nullif(trim(p_remarks), '')
   where id = p_irn_id;

  perform public._record_signature('grn', v_irn.grn_id, p_signature_id, auth.uid());

  return jsonb_build_object('ok', true, 'grn_line_id', v_line_id);
end;
$$;

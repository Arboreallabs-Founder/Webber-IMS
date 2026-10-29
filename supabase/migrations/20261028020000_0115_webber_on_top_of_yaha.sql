-- ============================================================
-- 0115 — Webber on top of the YAHA merge.
--
-- The YAHA migrations 0095–0112 were merged in unchanged. Where they rebuilt
-- something Webber had already changed in its own way, the YAHA version
-- replaced Webber's. This puts Webber's changes back on top:
--
--   1. GRN receiving keeps the MPN check (Webber 0100) on top of YAHA's
--      over-receipt guards (0096, 0105).
--   2. Stock created when a GRN is fully signed (YAHA's process_grn_line,
--      0096/0098) records the storage location typed at receiving (Webber
--      0104) and each box's MPN breakdown (Webber 0105). A slice reserved
--      inside a box counts its MPN in the box's breakdown.
--   3. Approving an IRN carries its MPN and location onto the GRN line
--      (Webber 0104) on top of YAHA's piece dimensions (0096).
--   4. Inventory Admin (Webber 0107/0108) keeps what it could do: receive
--      GRNs, submit IRNs, raise and issue requisitions, consume stock and
--      release blocked stock. YAHA's role lists only named YAHA's roles.
--   5. PO numbers are WEC/<FY>/NNNN instead of YAHA's YWSPL/<FY>/NNNN (0102).
--   6. New projects do not need a BOM (YAHA 0108 made 'required' the default).
-- ============================================================

-- ---------- 1. GRN line BEFORE INSERT ----------
create or replace function public.grn_line_before_insert()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ord  numeric;
  v_recv numeric;
begin
  if new.po_line_id is null and new.project_id is null then new.is_untagged := true; end if;

  if new.mpn_id is not null and not exists (
    select 1 from public.component_mpns where id = new.mpn_id and component_id = new.component_id
  ) then
    raise exception 'That MPN does not belong to the selected component';
  end if;

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

  if new.jw_line_id is not null then
    select l.qty_sent,
           greatest(coalesce(l.qty_returned, 0),
                    coalesce((select sum(g.qty_received) from public.grn_lines g where g.jw_line_id = l.id), 0))
      into v_ord, v_recv
      from public.job_work_lines l where l.id = new.jw_line_id;

    if v_ord is not null and v_recv + new.qty_received > v_ord + 1e-6 then
      raise exception
        'Over-receipt blocked: job-work line has % remaining (sent %, already received or awaiting inspection %); this GRN line adds %.',
        greatest(v_ord - v_recv, 0), v_ord, v_recv, new.qty_received
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------- 2. Stock creation once the GRN is fully signed ----------
create or replace function public.process_grn_line(p_grn_line_id uuid)
returns void
language plpgsql security definer set search_path = public as $function$
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
  v_box        public.inventory_lots;
begin
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
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
        container_no, created_by)
      values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id, v_jwline.raw_lot_id,
        0, case when v_n > 1 then 1 else rec.qty_received end, rec.unit_cost,
        case when v_track = 'item' then true else coalesce(v_is_ser, false) end,
        v_status, 'completed'::public.jw_stage, rec.location,
        case when v_track = 'box' then v_code else null end, rec.created_by)
      returning id into v_lot;
      if rec.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, rec.mpn_id, case when v_n > 1 then 1 else rec.qty_received end, rec.created_by);
      end if;
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

  elsif rec.target_lot_id is not null then
    if rec.project_id is not null then
      select * into v_box from public.inventory_lots where id = rec.target_lot_id;
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id,
        qty_on_hand, qty_initial, unit_cost, location, is_serialized, status, jw_stage,
        piece_length, piece_width, piece_weight, source_lot_id, created_by)
      values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id,
        0, rec.qty_received, rec.unit_cost, v_box.location, coalesce(v_is_ser, false), 'issued', v_stage,
        rec.piece_length, rec.piece_width, rec.piece_weight,
        coalesce(v_box.source_lot_id, v_box.id), rec.created_by)
      returning id into v_lot;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
      if rec.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (coalesce(v_box.source_lot_id, v_box.id), rec.mpn_id, rec.qty_received, rec.created_by)
        on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
      end if;
    else
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (rec.target_lot_id, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
      if rec.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (rec.target_lot_id, rec.mpn_id, rec.qty_received, rec.created_by)
        on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
      end if;
    end if;

  elsif v_track = 'item' and rec.qty_received = floor(rec.qty_received)
     and rec.qty_received > 0 and rec.qty_received <= 1000 then
    v_n := rec.qty_received::int;
    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location, created_by)
      values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id,
        0, 1, rec.unit_cost, true, v_status, v_stage, rec.location, rec.created_by)
      returning id into v_lot;
      if rec.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, rec.mpn_id, 1, rec.created_by);
      end if;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, rec.component_id, 'receipt', 1, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
    end loop;

  else
    v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
    insert into public.inventory_lots(
      lot_code, component_id, grn_line_id, vendor_id, project_id,
      qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
      container_no, piece_count, piece_length, piece_width, piece_weight, created_by)
    values (v_code, rec.component_id, rec.id, v_vendor, rec.project_id,
      0, rec.qty_received, rec.unit_cost, coalesce(v_is_ser, false), v_status, v_stage, rec.location,
      case when v_track = 'box' then v_code else null end,
      rec.piece_count, rec.piece_length, rec.piece_width, rec.piece_weight, rec.created_by)
    returning id into v_lot;
    if rec.mpn_id is not null then
      insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
      values (v_lot, rec.mpn_id, rec.qty_received, rec.created_by);
    end if;
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (v_lot, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
      'grn', rec.id, rec.created_by, rec.created_by);
  end if;

  update public.grn_lines set processed_at = now() where id = rec.id;
end;
$function$;

-- ---------- 3. IRN approval ----------
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
        piece_count, piece_length, piece_width, piece_weight, mpn_id, location, created_by)
  values (v_irn.grn_id, v_irn.component_id, v_irn.qty, v_irn.po_line_id, v_irn.project_id, v_irn.unit_cost, v_irn.target_lot_id, v_irn.jw_line_id,
        v_irn.piece_count, v_irn.piece_length, v_irn.piece_width, v_irn.piece_weight, v_irn.mpn_id, v_irn.location, v_irn.generated_by)
  returning id into v_line_id;

  update public.irns
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), grn_line_id = v_line_id,
         approval_remarks = nullif(trim(p_remarks), '')
   where id = p_irn_id;

  perform public._record_signature('grn', v_irn.grn_id, p_signature_id, auth.uid());

  return jsonb_build_object('ok', true, 'grn_line_id', v_line_id);
end;
$$;

-- ---------- 4. Inventory Admin ----------
alter policy grns_ins on public.grns
  with check (auth_role() = any (array['admin','team_lead','team_member','inventory_admin','floor']::public.role[]));
alter policy grnline_ins on public.grn_lines
  with check (auth_role() = any (array['admin','team_lead','team_member','inventory_admin','floor']::public.role[]));
alter policy req_ins on public.requisitions
  with check (auth_role() = any (array['admin','team_lead','team_member','inventory_admin','floor']::public.role[]));
alter policy reqline_ins on public.requisition_lines
  with check (auth_role() = any (array['admin','team_lead','team_member','inventory_admin','floor']::public.role[]));

-- These SECURITY DEFINER functions carry their own role allowlist. Add
-- inventory_admin to it in the live definition, and fail loudly unless the
-- list occurs exactly once, so a drifted body can't be silently half-patched.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('consume_from_lot',    $q$('admin', 'team_lead', 'team_member', 'floor')$q$),
      ('submit_irn',          $q$('admin','team_lead','team_member','floor')$q$),
      ('issue_requisition',   $q$('admin','team_lead')$q$),
      ('release_blocked_lot', $q$('admin', 'team_lead')$q$)
    ) as t(fn, old_list)
  loop
    select pg_get_functiondef(p.oid) into strict v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = r.fn;

    if (length(v_def) - length(replace(v_def, r.old_list, ''))) / length(r.old_list) <> 1 then
      raise exception '%: expected exactly one role allowlist %', r.fn, r.old_list;
    end if;

    execute replace(v_def, r.old_list, left(r.old_list, -1) || ', ''inventory_admin'')');
  end loop;
end $$;

-- ---------- 5. PO numbers: WEC/<FY>/NNNN ----------
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('peek_next_po_no', 'purchase_order_check_po_no')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('YWSPL' in v_def) = 0 then
      raise exception 'expected YWSPL in %', r.oid::regprocedure;
    end if;
    execute replace(v_def, 'YWSPL', 'WEC');
  end loop;
end $$;

-- ---------- 6. New projects work without a BOM ----------
-- 'legacy' = the BOM is optional (orders, blocking and consumption are not
-- gated on it). An Admin can still set a project to 'required'.
alter table public.projects alter column bom_policy set default 'legacy';

-- ============================================================
-- 0098 — Reserved slices remember their lot, scan-the-lot consumption,
-- and auto-release of reservations a project no longer needs.
--
-- A "slice" is a lot row that holds part of another lot's stock reserved
-- for a project. It has no sticker of its own: `source_lot_id` points at
-- the lot (box / bulk sticker) it physically sits in, so scanning that
-- sticker can find it. Slices are always one level deep — source_lot_id
-- always names a lot whose own source_lot_id is null.
-- ============================================================

alter table public.inventory_lots
  add column if not exists source_lot_id uuid references public.inventory_lots(id);
create index if not exists idx_lots_source on public.inventory_lots(source_lot_id);

-- ---------- internal: carve a slice out of a lot ----------
-- Moves p_qty from p_from_lot into a new slice via two transfer movements;
-- the recompute trigger derives both qty_on_hand values. A slice carved from
-- another slice keeps that slice's GRN link, so it prices the same.
create or replace function public._make_slice(
  p_from_lot uuid, p_qty numeric, p_status public.lot_status, p_project uuid,
  p_ref_type text, p_ref_id uuid, p_user uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_from public.inventory_lots;
  v_id   uuid;
begin
  select * into v_from from public.inventory_lots where id = p_from_lot;

  insert into public.inventory_lots(
    lot_code, component_id, grn_line_id, vendor_id, project_id, qty_on_hand, qty_initial,
    unit_cost, location, is_serialized, status, jw_stage,
    piece_length, piece_width, piece_weight, source_lot_id, created_by)
  values (
    'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    v_from.component_id,
    case when v_from.source_lot_id is not null then v_from.grn_line_id end,
    v_from.vendor_id, p_project, 0, p_qty,
    v_from.unit_cost, v_from.location, v_from.is_serialized, p_status, v_from.jw_stage,
    v_from.piece_length, v_from.piece_width, v_from.piece_weight,
    coalesce(v_from.source_lot_id, v_from.id), p_user)
  returning id into v_id;

  insert into public.stock_movements(
    lot_id, component_id, movement_type, qty, project_id,
    reference_type, reference_id, performed_by, created_by)
  values
    (v_from.id, v_from.component_id, 'transfer', -p_qty, coalesce(p_project, v_from.project_id),
     p_ref_type, p_ref_id, p_user, p_user),
    (v_id, v_from.component_id, 'transfer', p_qty, coalesce(p_project, v_from.project_id),
     p_ref_type, p_ref_id, p_user, p_user);

  return v_id;
end $$;

-- ---------- internal: release reserved stock back to open ----------
--   slice, source lot free      -> qty moves back into the source lot; an
--                                  emptied slice nothing was ever used from
--                                  is deleted
--   slice, source lot not free  -> released qty becomes open stock, still
--                                  linked to the source (merging would hand
--                                  it to whoever holds the source)
--   whole lot, all of it        -> flipped to open, same lot and sticker
--   whole lot, part of it       -> the sticker lot goes open; the part still
--                                  reserved moves into a slice linked to it
create or replace function public._release_lot(p_lot uuid, p_qty numeric, p_ref text, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lot  public.inventory_lots;
  v_src  public.inventory_lots;
  v_left numeric;
begin
  select * into v_lot from public.inventory_lots where id = p_lot for update;
  if not found or v_lot.status <> 'issued' or p_qty is null or p_qty <= 0 or p_qty > v_lot.qty_on_hand then
    raise exception 'Invalid release of % from lot %', p_qty, p_lot;
  end if;

  if v_lot.source_lot_id is not null then
    select * into v_src from public.inventory_lots where id = v_lot.source_lot_id for update;

    if v_src.project_id is null and v_src.status in ('open', 'consumed') then
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values
        (v_lot.id, v_lot.component_id, 'transfer', -p_qty, v_lot.project_id, p_ref, v_lot.id, p_user, p_user),
        (v_src.id, v_lot.component_id, 'transfer',  p_qty, v_lot.project_id, p_ref, v_lot.id, p_user, p_user);

      select qty_on_hand into v_left from public.inventory_lots where id = v_lot.id;
      if v_left <= 0 and not exists (
        select 1 from public.stock_movements
        where lot_id = v_lot.id and movement_type in ('receipt', 'issue', 'return', 'adjustment')
      ) then
        begin
          delete from public.stock_movements where lot_id = v_lot.id;
          delete from public.inventory_lots where id = v_lot.id;
        exception when foreign_key_violation then
          null; -- something else points at the slice; keep it, it is empty anyway
        end;
      end if;
      return;
    end if;

    if p_qty = v_lot.qty_on_hand then
      update public.inventory_lots set status = 'open', project_id = null where id = v_lot.id;
    else
      perform public._make_slice(v_lot.id, p_qty, 'open', null, p_ref, v_lot.id, p_user);
    end if;
    return;
  end if;

  if p_qty < v_lot.qty_on_hand then
    perform public._make_slice(v_lot.id, v_lot.qty_on_hand - p_qty, 'issued', v_lot.project_id, p_ref, v_lot.id, p_user);
  end if;
  update public.inventory_lots set status = 'open', project_id = null where id = v_lot.id;
end $$;

-- ---------- internal: release whatever a project no longer needs ----------
-- Requirement = bigger of the approved BOM qty and the approved PO qty for the
-- project. Requisitions never count as the requirement. No BOM and no PO ->
-- nothing is released. Job-work components are skipped: their completed parts
-- come back reserved after the raw stock was already counted as consumed.
create or replace function public._auto_release(p_project uuid, p_component uuid, p_user uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_bom      numeric;
  v_po       numeric;
  v_cons     numeric;
  v_reserved numeric;
  v_excess   numeric;
  v_take     numeric;
  v_ids      uuid[];
  v_id       uuid;
  v_qty      numeric;
  v_released numeric := 0;
begin
  if p_project is null or p_component is null then return 0; end if;
  if coalesce((select is_job_work from public.components where id = p_component), false) then return 0; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project::text || ':' || p_component::text, 0));

  select sum(bl.required_qty) into v_bom
    from public.boms b join public.bom_lines bl on bl.bom_id = b.id
   where b.project_id = p_project and b.status = 'approved' and bl.component_id = p_component;
  select sum(qty_ordered) into v_po
    from public.po_lines
   where project_id = p_project and component_id = p_component
     and approval_status = 'approved' and line_status <> 'cancelled';
  if v_bom is null and v_po is null then return 0; end if;

  select coalesce(sum(-qty), 0) into v_cons
    from public.stock_movements
   where project_id = p_project and component_id = p_component
     and movement_type in ('issue', 'return');

  select coalesce(sum(qty_on_hand), 0), array_agg(id order by created_at, id)
    into v_reserved, v_ids
    from public.inventory_lots
   where project_id = p_project and component_id = p_component
     and status = 'issued' and qty_on_hand > 0;

  v_excess := v_reserved - greatest(greatest(coalesce(v_bom, 0), coalesce(v_po, 0)) - v_cons, 0);
  if v_excess <= 0 or v_ids is null then return 0; end if;

  foreach v_id in array v_ids loop
    exit when v_excess <= 0;
    select qty_on_hand into v_qty from public.inventory_lots
     where id = v_id and status = 'issued' and qty_on_hand > 0 for update;
    continue when v_qty is null;
    v_take := least(v_qty, v_excess);
    perform public._release_lot(v_id, v_take, 'auto_release', p_user);
    v_excess   := v_excess - v_take;
    v_released := v_released + v_take;
  end loop;

  return v_released;
end $$;

-- ---------- public: consume by scanning a lot's sticker ----------
-- Takes from stock reserved for this project in that lot (the lot itself or
-- its slices) first, then from its open stock. Never touches another
-- project's reservation. Then releases anything the project no longer needs.
create or replace function public.consume_from_lot(
  p_lot_id uuid, p_project_id uuid, p_qty numeric,
  p_requisition_id uuid default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role     public.role;
  v_uid      uuid := auth.uid();
  v_scan     public.inventory_lots;
  v_root     public.inventory_lots;
  v_ids      uuid[];
  v_id       uuid;
  v_avail    numeric;
  v_left     numeric;
  v_qty      numeric;
  v_take     numeric;
  v_ref      text;
  v_released numeric := 0;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin', 'team_lead', 'team_member') then
    return jsonb_build_object('error', 'Not authorized.');
  end if;
  if p_project_id is null then
    if v_role <> 'admin' then
      return jsonb_build_object('error', 'Only Admin can consume stock without a project.');
    end if;
    if coalesce(trim(p_note), '') = '' then
      return jsonb_build_object('error', 'Enter a reason (e.g. R&D, sample) for stock consumption.');
    end if;
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('error', 'Enter a quantity to consume.');
  end if;

  select * into v_scan from public.inventory_lots where id = p_lot_id;
  if not found then return jsonb_build_object('error', 'Lot not found.'); end if;
  if v_scan.jw_stage = 'raw' then
    return jsonb_build_object('error', 'This is a raw job-work lot — send it for job work and receive the completed part before consuming.');
  end if;

  select * into v_root from public.inventory_lots
   where id = coalesce(v_scan.source_lot_id, v_scan.id);

  perform 1 from public.inventory_lots
   where id = v_root.id or source_lot_id = v_root.id
   for update;

  select array_agg(id order by grp, (id <> v_root.id), created_at, id) into v_ids
  from (
    select id, created_at,
           case when project_id = p_project_id and status in ('issued', 'open') then 0
                when project_id is null and status = 'open' then 1 end as grp
      from public.inventory_lots
     where (id = v_root.id or source_lot_id = v_root.id)
       and qty_on_hand > 0
       and jw_stage is distinct from 'raw'
  ) f
  where grp is not null;

  select coalesce(sum(qty_on_hand), 0) into v_avail
    from public.inventory_lots where id = any(coalesce(v_ids, '{}'));

  if v_avail <= 0 then
    if v_root.project_id is not null and v_root.project_id is distinct from p_project_id and v_root.qty_on_hand > 0 then
      return jsonb_build_object('error', 'This lot is reserved for another project and cannot be consumed here.');
    end if;
    return jsonb_build_object('error', 'Nothing left on hand in this lot.');
  end if;
  if p_qty > v_avail then
    return jsonb_build_object('error', 'Only ' || trim_scale(v_avail) || ' available in this lot.');
  end if;

  v_ref := case when p_requisition_id is not null then 'requisition'
                when p_project_id is not null then 'scan'
                else 'scan-stock' end;
  v_left := p_qty;

  foreach v_id in array v_ids loop
    exit when v_left <= 0;
    select qty_on_hand into v_qty from public.inventory_lots where id = v_id;
    v_take := least(v_qty, v_left);
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, note, performed_by, created_by)
    values (v_id, v_scan.component_id, 'issue', -v_take, p_project_id,
            v_ref, p_requisition_id, nullif(trim(p_note), ''), v_uid, v_uid);
    v_left := v_left - v_take;
  end loop;

  if p_project_id is not null then
    v_released := public._auto_release(p_project_id, v_scan.component_id, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'released', v_released);
end $$;

-- ---------- public: manual unissue (whole or part) ----------
create or replace function public.release_blocked_lot(p_lot_id uuid, p_qty numeric default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role public.role;
  v_lot  public.inventory_lots;
  v_qty  numeric;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin', 'team_lead') then
    return jsonb_build_object('error', 'Only Admin / Team Lead can unissue a lot.');
  end if;
  select * into v_lot from public.inventory_lots where id = p_lot_id;
  if not found or v_lot.status <> 'issued' or v_lot.qty_on_hand <= 0 then
    return jsonb_build_object('error', 'Only a reserved lot with stock on hand can be unissued.');
  end if;
  v_qty := coalesce(p_qty, v_lot.qty_on_hand);
  if v_qty <= 0 or v_qty > v_lot.qty_on_hand then
    return jsonb_build_object('error', 'Enter a quantity between 0 and ' || trim_scale(v_lot.qty_on_hand) || '.');
  end if;
  perform public._release_lot(p_lot_id, v_qty, 'unissue', auth.uid());
  return jsonb_build_object('ok', true);
end $$;

-- ---------- public: recheck a project's reservations (on BOM approval) ----------
create or replace function public.recheck_project_reservations(p_project_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role     public.role;
  v_comp     uuid;
  v_released numeric := 0;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin', 'team_lead') then
    return jsonb_build_object('error', 'Not authorized.');
  end if;
  for v_comp in
    select distinct component_id from public.inventory_lots
     where project_id = p_project_id and status = 'issued' and qty_on_hand > 0 and component_id is not null
  loop
    v_released := v_released + public._auto_release(p_project_id, v_comp, auth.uid());
  end loop;
  return jsonb_build_object('ok', true, 'released', v_released);
end $$;

revoke all on function public._make_slice(uuid, numeric, public.lot_status, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public._release_lot(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public._auto_release(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_from_lot(uuid, uuid, numeric, uuid, text) from public, anon;
revoke all on function public.release_blocked_lot(uuid, numeric) from public, anon;
revoke all on function public.recheck_project_reservations(uuid) from public, anon;
grant execute on function public.consume_from_lot(uuid, uuid, numeric, uuid, text) to authenticated;
grant execute on function public.release_blocked_lot(uuid, numeric) to authenticated;
grant execute on function public.recheck_project_reservations(uuid) to authenticated;

-- ---------- issue_requisition: link slices, skip raw job-work stock ----------
-- Same as 0097 except: raw job-work lots are never picked, and a partial take
-- becomes a slice linked to its lot (via _make_slice) instead of an unlinked
-- lot. The source lot's qty_initial is no longer reduced — it stays what was
-- received.
create or replace function public.issue_requisition(p_req_id uuid, p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $function$
DECLARE
  v_role        public.role;
  v_req         RECORD;
  v_line        RECORD;
  v_lot         RECORD;
  v_remaining   numeric;
  v_take        numeric;
  v_short       jsonb := '[]'::jsonb;
  v_any_covered boolean := false;
  v_all_covered boolean := true;
BEGIN
  v_role := public.auth_role();
  IF v_role IS NULL OR v_role NOT IN ('admin','team_lead') THEN
    RETURN jsonb_build_object('error', 'Only Admin / Team Lead can issue requisitions.');
  END IF;

  SELECT * INTO v_req FROM public.requisitions WHERE id = p_req_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Requisition not found');
  END IF;
  IF v_req.status NOT IN ('open', 'partially_issued') THEN
    RETURN jsonb_build_object('error', 'Only open or partially-issued requisitions can be issued');
  END IF;

  FOR v_line IN
    SELECT rl.component_id, rl.qty,
           c.component_no || ' — ' || c.name AS label
    FROM   public.requisition_lines rl
    JOIN   public.components c ON c.id = rl.component_id
    WHERE  rl.requisition_id = p_req_id
  LOOP
    v_remaining := v_line.qty - coalesce((
      SELECT sum(qty_on_hand) FROM public.inventory_lots
      WHERE component_id = v_line.component_id AND status = 'issued' AND project_id = v_req.project_id
    ), 0);
    IF v_remaining <= 0 THEN
      v_any_covered := true;
      CONTINUE;
    END IF;

    FOR v_lot IN
      SELECT id, qty_on_hand
      FROM   public.inventory_lots
      WHERE  component_id = v_line.component_id
        AND  status = 'open'
        AND  qty_on_hand > 0
        AND  (project_id IS NULL OR project_id = v_req.project_id)
        AND  jw_stage IS DISTINCT FROM 'raw'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.qty_on_hand, v_remaining);

      IF v_take >= v_lot.qty_on_hand THEN
        UPDATE public.inventory_lots
        SET status = 'issued', project_id = v_req.project_id
        WHERE id = v_lot.id;
      ELSE
        PERFORM public._make_slice(v_lot.id, v_take, 'issued', v_req.project_id,
                                   'requisition_block', p_req_id, p_user_id);
      END IF;

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      v_all_covered := false;
      v_short := v_short || jsonb_build_array(jsonb_build_object('label', v_line.label, 'short_qty', v_remaining));
    ELSE
      v_any_covered := true;
    END IF;
  END LOOP;

  UPDATE public.requisitions
     SET status = CASE
       WHEN v_all_covered THEN 'issued'
       WHEN v_any_covered THEN 'partially_issued'
       ELSE v_req.status
     END
   WHERE id = p_req_id;

  RETURN jsonb_build_object('ok', true, 'fully_covered', v_all_covered, 'short', v_short);
END;
$function$;

-- ---------- process_grn_line: project stock added to an existing box ----------
-- Same as 0096 except the add-to-existing-box branch: when the GRN line is for
-- a project, the quantity is received into a slice reserved for that project
-- and linked to the box, instead of silently joining the box's open stock.
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
    else
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (rec.target_lot_id, rec.component_id, 'receipt', rec.qty_received, rec.project_id,
        'grn', rec.id, rec.created_by, rec.created_by);
    end if;

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
$function$;

-- ---------- valuation: a slice is priced like the lot it sits in ----------
create or replace view public.v_component_on_hand with (security_invoker = true) as
select c.id as component_id,
       c.component_no,
       c.name,
       c.uom,
       coalesce(sum(l.qty_on_hand), 0::numeric) as qty_on_hand,
       coalesce(sum(l.qty_on_hand * coalesce(pl.rate, spl.rate, l.unit_cost)), 0::numeric) as stock_value,
       count(l.id) filter (where l.status <> 'consumed'::lot_status) as lot_count,
       (count(l.id) > 0) as has_stock_history
from components c
left join inventory_lots l on l.component_id = c.id
left join grn_lines gl on gl.id = l.grn_line_id
left join po_lines pl on pl.id = gl.po_line_id and pl.approval_status = 'approved'::po_line_approval_status
left join inventory_lots sl on sl.id = l.source_lot_id
left join grn_lines sgl on sgl.id = sl.grn_line_id
left join po_lines spl on spl.id = sgl.po_line_id and spl.approval_status = 'approved'::po_line_approval_status
group by c.id, c.component_no, c.name, c.uom;

create or replace view public.v_project_consumption with (security_invoker = true) as
select m.project_id,
       m.component_id,
       sum(-m.qty) as consumed_qty,
       sum((-m.qty) * coalesce(pl.rate, spl.rate, l.unit_cost)) as consumption_value
from stock_movements m
join inventory_lots l on l.id = m.lot_id
left join grn_lines gl on gl.id = l.grn_line_id
left join po_lines pl on pl.id = gl.po_line_id and pl.approval_status = 'approved'::po_line_approval_status
left join inventory_lots sl on sl.id = l.source_lot_id
left join grn_lines sgl on sgl.id = sl.grn_line_id
left join po_lines spl on spl.id = sgl.po_line_id and spl.approval_status = 'approved'::po_line_approval_status
where m.movement_type = any (array['issue'::movement_type, 'return'::movement_type])
  and m.project_id is not null
group by m.project_id, m.component_id;

-- ---------- v_bom_variance: count a slice by what the project actually kept ----------
-- Same as 0070 except the reserved-lot branch of "received": a slice counts
-- what was consumed from it plus what is still reserved in it (not its initial
-- qty, which ignores releases), and a slice carved out of stock the project
-- already received on its own GRN is not counted a second time.
create or replace view public.v_bom_variance with (security_invoker = true) as
with req as (
  select b.project_id, bl.component_id, sum(bl.required_qty) as required_qty
  from boms b join bom_lines bl on bl.bom_id = b.id
  where bl.component_id is not null
  group by b.project_id, bl.component_id
), ord as (
  select pl.project_id, pl.component_id, sum(pl.qty_ordered) as ordered_qty
  from po_lines pl
  where pl.project_id is not null and pl.component_id is not null and pl.line_status <> 'cancelled'::po_line_status
  group by pl.project_id, pl.component_id
), rcv as (
  select src.project_id, src.component_id, sum(src.qty) as received_qty
  from (
    select gl.project_id, gl.component_id, gl.qty_received as qty
    from grn_lines gl
    where gl.project_id is not null and gl.component_id is not null
    union all
    select l.project_id, l.component_id,
           case when l.source_lot_id is null then l.qty_initial
                else coalesce((select sum(-m.qty) from stock_movements m
                               where m.lot_id = l.id and m.movement_type in ('issue', 'return')), 0)
                     + case when l.status = 'issued' then l.qty_on_hand else 0 end
           end as qty
    from inventory_lots l
    where l.project_id is not null and l.component_id is not null and l.grn_line_id is null
      and l.status = any (array['issued'::lot_status, 'consumed'::lot_status])
      and not exists (
        select 1 from inventory_lots r join grn_lines rg on rg.id = r.grn_line_id
        where r.id = l.source_lot_id and rg.project_id = l.project_id
      )
  ) src
  group by src.project_id, src.component_id
), csm as (
  select sm.project_id, sm.component_id, sum(-sm.qty) as consumed_qty
  from stock_movements sm
  where sm.movement_type = 'issue'::movement_type and sm.project_id is not null
    and sm.component_id is not null and sm.reference_type is distinct from 'job_work'::text
  group by sm.project_id, sm.component_id
), oh as (
  select il.project_id, il.component_id, sum(il.qty_on_hand) as qty
  from inventory_lots il
  where il.status <> 'consumed'::lot_status and il.qty_on_hand > 0::numeric and il.component_id is not null
  group by il.project_id, il.component_id
), keys as (
  select req_1.project_id, req_1.component_id from req req_1
  union select ord_1.project_id, ord_1.component_id from ord ord_1
  union select rcv_1.project_id, rcv_1.component_id from rcv rcv_1
  union select csm_1.project_id, csm_1.component_id from csm csm_1
), ohk as (
  select k_1.project_id, k_1.component_id, coalesce(sum(o.qty), 0::numeric) as on_hand_qty
  from keys k_1
  left join oh o on o.component_id = k_1.component_id and (o.project_id is null or o.project_id = k_1.project_id)
  group by k_1.project_id, k_1.component_id
)
select k.project_id,
       k.component_id,
       coalesce(req.required_qty, 0::numeric) as required_qty,
       coalesce(ord.ordered_qty, 0::numeric) as ordered_qty,
       coalesce(rcv.received_qty, 0::numeric) as received_qty,
       coalesce(req.required_qty, 0::numeric) - coalesce(ord.ordered_qty, 0::numeric) as order_gap,
       coalesce(ord.ordered_qty, 0::numeric) - coalesce(rcv.received_qty, 0::numeric) as receive_gap,
       coalesce(csm.consumed_qty, 0::numeric) as consumed_qty,
       coalesce(ohk.on_hand_qty, 0::numeric) as on_hand_qty,
       greatest(coalesce(req.required_qty, 0::numeric) - coalesce(ord.ordered_qty, 0::numeric)
                - coalesce(csm.consumed_qty, 0::numeric) - coalesce(ohk.on_hand_qty, 0::numeric), 0::numeric) as uncovered_qty
from keys k
left join req on req.project_id = k.project_id and req.component_id = k.component_id
left join ord on ord.project_id = k.project_id and ord.component_id = k.component_id
left join rcv on rcv.project_id = k.project_id and rcv.component_id = k.component_id
left join csm on csm.project_id = k.project_id and csm.component_id = k.component_id
left join ohk on ohk.project_id = k.project_id and ohk.component_id = k.component_id;

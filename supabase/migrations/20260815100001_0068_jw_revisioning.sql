-- Job-work order revisioning (mirrors purchase_orders' root_po_id/revision_no/
-- superseded_by system) plus draft-only delete. See migrations 0047/0049/0050/0051
-- for the PO precedent this ports. Key physical difference from POs: by the time
-- a JW order is 'sent', its raw material has already left the building (a real
-- stock-out movement was recorded at dispatch), so:
--   - removing an already-dispatched, not-yet-returned line auto-reverses that
--     stock movement (returns the material to stock) instead of just vanishing it
--   - the vendor is never editable via revision (material is physically at a
--     specific vendor's site)
--   - only rate is editable on an existing dispatched line — qty/raw-lot are not

-- ---------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------
alter table public.job_work_orders drop constraint job_work_orders_status_check;
alter table public.job_work_orders add constraint job_work_orders_status_check
  check (status = any (array['draft','sent','partial','received','cancelled','superseded']));

alter table public.job_work_orders
  add column root_jw_id uuid references public.job_work_orders(id) on delete set null,
  add column revision_no integer not null default 0,
  add column superseded_by uuid references public.job_work_orders(id) on delete set null;

-- ---------------------------------------------------------------------
-- clone_jw_revision: forks a sent/partial/received JW order into a new
-- "...R<n>" order, applying exactly one line add/update/remove, carrying
-- every other line forward untouched (including its receipt history —
-- qty_returned/completed_lot_id are NOT recomputed, they're copied as-is),
-- remapping grn_lines.jw_line_id/irns.jw_line_id so receiving/inspection
-- history stays linked to the live revision, and superseding the old order.
-- ---------------------------------------------------------------------
create or replace function public.clone_jw_revision(
  p_old_jw_id uuid, p_kind text, p_line_id uuid, p_patch jsonb, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role        public.role;
  v_actor       uuid := auth.uid();
  v_old         record;
  v_root_id     uuid;
  v_root_jw_no  text;
  v_new_id      uuid;
  v_new_revno   int;
  v_new_jw_no   text;
  v_line        record;
  v_new_line_id uuid;
  v_target      record;
  v_lot         record;
  v_new_raw_lot uuid;
  v_new_comp    uuid;
  v_new_qty     numeric;
  v_new_rate    numeric;
  v_total_sent  numeric := 0;
  v_total_ret   numeric := 0;
  v_new_status  text;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    return jsonb_build_object('error','Only Admin / Team Lead can edit this job-work order.');
  end if;

  select * into v_old from public.job_work_orders where id = p_old_jw_id for update;
  if not found then return jsonb_build_object('error','Job-work order not found.'); end if;
  if v_old.status not in ('sent','partial','received') then
    return jsonb_build_object('error','This job-work order can no longer be edited.');
  end if;

  -- Preflight validation BEFORE any row is written — a rejected edit must
  -- leave zero side effects (lesson from PO revisioning migration 0051).
  if p_kind in ('remove','update') then
    select * into v_target from public.job_work_lines where id = p_line_id and jw_order_id = p_old_jw_id;
    if not found then return jsonb_build_object('error','Line not found.'); end if;
    if p_kind = 'remove' and coalesce(v_target.qty_returned, 0) > 0 then
      return jsonb_build_object('error','Cannot remove a line that already has material returned against it.');
    end if;
  end if;

  if p_kind = 'add' then
    v_new_comp    := (p_patch->>'component_id')::uuid;
    v_new_raw_lot := (p_patch->>'raw_lot_id')::uuid;
    v_new_qty     := (p_patch->>'qty_sent')::numeric;
    if v_new_comp is null then return jsonb_build_object('error','Pick a job-work component.'); end if;
    if v_new_raw_lot is null then return jsonb_build_object('error','Pick the raw lot to send.'); end if;
    if v_new_qty is null or v_new_qty <= 0 then return jsonb_build_object('error','Enter a quantity to send.'); end if;
    select * into v_lot from public.inventory_lots where id = v_new_raw_lot for update;
    if not found then return jsonb_build_object('error','Raw lot not found.'); end if;
    if coalesce(v_lot.qty_on_hand, 0) < v_new_qty then
      return jsonb_build_object('error', format('Raw lot %s has only %s available.', v_lot.lot_code, v_lot.qty_on_hand));
    end if;
  end if;

  v_root_id := coalesce(v_old.root_jw_id, v_old.id);
  select jw_no into v_root_jw_no from public.job_work_orders where id = v_root_id;

  select coalesce(max(revision_no), 0) + 1 into v_new_revno
    from public.job_work_orders
   where id = v_root_id or root_jw_id = v_root_id;

  v_new_jw_no := v_root_jw_no || 'R' || v_new_revno;

  insert into public.job_work_orders
    (jw_no, vendor_id, project_id, status, sent_date, expected_date, root_jw_id, revision_no, created_by)
  values (v_new_jw_no, v_old.vendor_id, v_old.project_id, 'sent', v_old.sent_date, v_old.expected_date,
          v_root_id, v_new_revno, v_actor)
  returning id into v_new_id;

  for v_line in select * from public.job_work_lines where jw_order_id = p_old_jw_id loop
    if p_kind = 'remove' and v_line.id = p_line_id then
      insert into public.stock_movements(lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_line.raw_lot_id, v_line.component_id, 'receipt', v_line.qty_sent, v_old.project_id,
        'job_work', p_old_jw_id, v_actor, v_actor);
      continue;
    end if;

    if p_kind = 'update' and v_line.id = p_line_id then
      v_new_rate := coalesce((p_patch->>'jw_rate')::numeric, v_line.jw_rate);
      insert into public.job_work_lines
        (jw_order_id, component_id, raw_lot_id, qty_sent, qty_returned, completed_lot_id, jw_rate, created_by)
      values (v_new_id, v_line.component_id, v_line.raw_lot_id, v_line.qty_sent, v_line.qty_returned,
              v_line.completed_lot_id, v_new_rate, v_actor)
      returning id into v_new_line_id;
    else
      insert into public.job_work_lines
        (jw_order_id, component_id, raw_lot_id, qty_sent, qty_returned, completed_lot_id, jw_rate, created_by)
      values (v_new_id, v_line.component_id, v_line.raw_lot_id, v_line.qty_sent, v_line.qty_returned,
              v_line.completed_lot_id, v_line.jw_rate, v_actor)
      returning id into v_new_line_id;
    end if;

    update public.grn_lines set jw_line_id = v_new_line_id where jw_line_id = v_line.id;
    update public.irns set jw_line_id = v_new_line_id where jw_line_id = v_line.id;

    v_total_sent := v_total_sent + v_line.qty_sent;
    v_total_ret  := v_total_ret + coalesce(v_line.qty_returned, 0);
  end loop;

  if p_kind = 'add' then
    insert into public.job_work_lines
      (jw_order_id, component_id, raw_lot_id, qty_sent, qty_returned, jw_rate, created_by)
    values (v_new_id, v_new_comp, v_new_raw_lot, v_new_qty, 0, (p_patch->>'jw_rate')::numeric, v_actor);

    insert into public.stock_movements(lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (v_new_raw_lot, v_new_comp, 'issue', -v_new_qty, v_old.project_id,
      'job_work', v_new_id, v_actor, v_actor);

    v_total_sent := v_total_sent + v_new_qty;
  end if;

  v_new_status := case
    when v_total_sent > 0 and v_total_ret >= v_total_sent then 'received'
    when v_total_ret > 0 then 'partial'
    else 'sent'
  end;
  update public.job_work_orders set status = v_new_status where id = v_new_id;

  update public.job_work_orders set status = 'superseded', superseded_by = v_new_id where id = p_old_jw_id;

  return jsonb_build_object('ok', true, 'id', v_new_id, 'jw_no', v_new_jw_no);
end; $function$;

revoke execute on function public.clone_jw_revision(uuid, text, uuid, jsonb, uuid) from anon, public;
grant  execute on function public.clone_jw_revision(uuid, text, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS: split jwo_mod (FOR ALL) so DELETE gets its own draft-only gate —
-- a permissive ALL policy would otherwise OR-override a narrower DELETE
-- policy. No admin/founder override (JW has no founder involvement
-- anywhere today, unlike PO's canDeletePurchaseOrders).
-- ---------------------------------------------------------------------
drop policy if exists jwo_mod on public.job_work_orders;

create policy jwo_ins on public.job_work_orders for insert to authenticated
  with check (auth_role() in ('admin','team_lead'));

create policy jwo_upd on public.job_work_orders for update to authenticated
  using (auth_role() in ('admin','team_lead'))
  with check (auth_role() in ('admin','team_lead'));

create policy jwo_del on public.job_work_orders for delete to authenticated
  using (auth_role() in ('admin','team_lead') and status = 'draft');

-- job_work_lines: direct (non-RPC) writes are now draft-only at the RLS
-- level too — every non-draft line edit must go through clone_jw_revision
-- (a SECURITY DEFINER function, so it isn't affected by this narrowing).
drop policy if exists jwl_mod on public.job_work_lines;

create policy jwl_mod on public.job_work_lines for all to authenticated
  using (
    auth_role() in ('admin','team_lead')
    and exists (select 1 from public.job_work_orders o where o.id = job_work_lines.jw_order_id and o.status = 'draft')
  )
  with check (
    auth_role() in ('admin','team_lead')
    and exists (select 1 from public.job_work_orders o where o.id = job_work_lines.jw_order_id and o.status = 'draft')
  );

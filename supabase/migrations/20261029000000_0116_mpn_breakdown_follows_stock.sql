-- ============================================================
-- 0116 — A lot's MPN breakdown follows its stock (Webber, on top of
-- YAHA's reserved slices, 0098).
--
-- Until now inventory_lot_mpns only ever grew: it recorded what each box
-- RECEIVED per MPN, and consuming, blocking or a stock-take never touched
-- it. Now it is what is LEFT per MPN:
--   * blocking part of a box (_make_slice) moves that qty of MPNs into
--     the slice; releasing a slice back into its box moves them back
--   * every consumption ('issue') and every stock-take shortfall takes
--     MPNs off the lot — newest-received first, the units on top of the
--     box — and logs exactly which ones in stock_movement_mpns
--   * reversing a consumption puts back exactly what that consumption took
--   * a stock-take that finds MORE can only be attributed when the lot
--     has a single MPN; otherwise it stays unassigned
-- Rows that reach 0 are kept (qty 0), so a lot remembers which MPN(s) it
-- held; screens show only qty > 0.
-- ============================================================

-- ---- 1. Which MPNs each outgoing movement took ----
create table if not exists public.stock_movement_mpns (
  movement_id uuid not null references public.stock_movements(id) on delete cascade,
  mpn_id      uuid not null references public.component_mpns(id),
  qty         numeric not null,
  primary key (movement_id, mpn_id)
);
alter table public.stock_movement_mpns enable row level security;
drop policy if exists stock_movement_mpns_sel on public.stock_movement_mpns;
create policy stock_movement_mpns_sel on public.stock_movement_mpns for select to authenticated using (true);
grant select on public.stock_movement_mpns to authenticated;

-- ---- 2. Move (or, with p_to null, use up) p_qty of a lot's MPNs ----
-- Newest-received MPN first. With p_movement set, logs what was taken.
create or replace function public._move_mpn(
  p_from uuid, p_to uuid, p_qty numeric, p_user uuid, p_movement uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_left numeric := p_qty;
  v_take numeric;
begin
  if p_from is null or p_qty is null or p_qty <= 0 then return; end if;
  for r in
    select id, mpn_id, qty from public.inventory_lot_mpns
     where lot_id = p_from and qty > 0
     order by created_at desc, id
     for update
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    update public.inventory_lot_mpns set qty = qty - v_take where id = r.id;
    if p_to is not null then
      insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
      values (p_to, r.mpn_id, v_take, p_user)
      on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
    end if;
    if p_movement is not null then
      insert into public.stock_movement_mpns(movement_id, mpn_id, qty)
      values (p_movement, r.mpn_id, v_take)
      on conflict (movement_id, mpn_id) do update set qty = public.stock_movement_mpns.qty + excluded.qty;
    end if;
    v_left := v_left - v_take;
  end loop;
end $$;

-- ---- 3. Consumption, stock-take and reversal keep the breakdown in step ----
-- A trigger rather than edits to each writer: consume_from_lot, the
-- stock-take and the consumption reversal (both written by the app
-- directly) are all covered. Transfers are handled where they are made
-- (_make_slice / _release_lot), since only there are both lots known.
create or replace function public.stock_movements_track_mpn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lot_id is null or new.qty = 0 then return null; end if;

  if new.qty < 0 and new.movement_type in ('issue', 'adjustment') then
    perform public._move_mpn(new.lot_id, null, -new.qty, new.created_by, new.id);

  elsif new.movement_type = 'return' and new.reference_type = 'consumption_reversal'
        and new.reference_id is not null then
    insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
    select new.lot_id, m.mpn_id, m.qty, new.created_by
      from public.stock_movement_mpns m where m.movement_id = new.reference_id
    on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;

  elsif new.qty > 0 and new.movement_type = 'adjustment'
        and (select count(*) from public.inventory_lot_mpns where lot_id = new.lot_id) = 1 then
    update public.inventory_lot_mpns set qty = qty + new.qty where lot_id = new.lot_id;
  end if;

  return null;
end $$;

drop trigger if exists trg_stock_movements_track_mpn on public.stock_movements;
create trigger trg_stock_movements_track_mpn after insert on public.stock_movements
  for each row execute function public.stock_movements_track_mpn();

-- ---- 4. Blocking moves the MPNs into the slice (YAHA 0098 + _move_mpn) ----
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

  perform public._move_mpn(v_from.id, v_id, p_qty, p_user);

  return v_id;
end $$;

-- ---- 5. Releasing a slice into its box moves the MPNs back (YAHA 0098 + _move_mpn) ----
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
      perform public._move_mpn(v_lot.id, v_src.id, p_qty, p_user);

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

-- ---- 6. Receiving into a box for a project: the new slice holds its own MPN ----
-- 0115 recorded it on the box, because the breakdown then belonged to the box.
do $$
declare
  v_def text := pg_get_functiondef('public.process_grn_line(uuid)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def,
    'values (coalesce(v_box.source_lot_id, v_box.id), rec.mpn_id, rec.qty_received, rec.created_by)',
    'values (v_lot, rec.mpn_id, rec.qty_received, rec.created_by)');
  if v_new = v_def then
    raise exception '0116: process_grn_line did not contain the expected MPN insert';
  end if;
  execute v_new;
end $$;

-- ---- 7. Bring existing breakdowns in line with stock ----
-- (On the Webber database at the time of writing every breakdown already
-- matched — nothing had been consumed or sliced — so this changes nothing
-- there. It is here for any database where that is not true.)
do $$
declare r record;
begin
  -- Live slices take their share of MPNs out of their box.
  for r in
    select s.id, s.source_lot_id, s.created_by,
           s.qty_on_hand - coalesce((select sum(qty) from public.inventory_lot_mpns where lot_id = s.id), 0) as short
      from public.inventory_lots s
     where s.source_lot_id is not null and s.qty_on_hand > 0
     order by s.created_at, s.id
  loop
    if r.short > 0 then perform public._move_mpn(r.source_lot_id, r.id, r.short, r.created_by); end if;
  end loop;
  -- Then every lot drops whatever it no longer holds.
  for r in
    select l.id, l.created_by, sum(m.qty) - l.qty_on_hand as excess
      from public.inventory_lots l join public.inventory_lot_mpns m on m.lot_id = l.id
     group by l.id, l.created_by, l.qty_on_hand
    having sum(m.qty) > l.qty_on_hand
  loop
    perform public._move_mpn(r.id, null, r.excess, r.created_by);
  end loop;
end $$;

revoke all on function public._move_mpn(uuid, uuid, numeric, uuid, uuid) from public, anon, authenticated;
revoke all on function public.stock_movements_track_mpn() from public, anon, authenticated;
revoke all on function public._make_slice(uuid, numeric, public.lot_status, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public._release_lot(uuid, numeric, text, uuid) from public, anon, authenticated;

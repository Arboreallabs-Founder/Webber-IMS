-- ============================================================
-- 0105 — Corrects 0100: a box is scoped to one WPC, but can genuinely
-- hold units from more than one manufacturer mixed together (e.g. 5
-- from MPN-A topped up with 3 more from MPN-B later). inventory_lots
-- no longer carries a single mpn_id; instead each lot has a breakdown
-- of how many units came from which MPN. grn_lines.mpn_id is
-- unchanged — one receiving line is still one MPN, one quantity; the
-- mixing happens across separate receiving events into the same box.
-- ============================================================

create table public.inventory_lot_mpns (
  id         uuid primary key default gen_random_uuid(),
  lot_id     uuid not null references public.inventory_lots(id) on delete cascade,
  mpn_id     uuid not null references public.component_mpns(id),
  qty        numeric not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (lot_id, mpn_id)
);
alter table public.inventory_lot_mpns enable row level security;
create index idx_inventory_lot_mpns_lot on public.inventory_lot_mpns(lot_id);
create index idx_inventory_lot_mpns_mpn on public.inventory_lot_mpns(mpn_id);

create policy inventory_lot_mpns_sel on public.inventory_lot_mpns for select to authenticated using (true);
create policy inventory_lot_mpns_mod on public.inventory_lot_mpns for all to authenticated
  using (public.auth_role() in ('admin','team_lead'))
  with check (public.auth_role() in ('admin','team_lead'));
grant select, insert, update, delete on public.inventory_lot_mpns to authenticated;

alter table public.inventory_lots drop column mpn_id;

create or replace function public.grn_line_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
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
  v_piece_qty  numeric;
  v_jwline     record;
  v_last       uuid;
  v_total_sent numeric;
  v_total_ret  numeric;
begin
  select tracking_mode, is_serialized, is_job_work
    into v_track, v_is_ser, v_is_jw
    from public.components where id = NEW.component_id;
  v_stage  := case when coalesce(v_is_jw, false) then 'raw'::public.jw_stage else null end;
  v_vendor := (select vendor_id from public.grns where id = NEW.grn_id);
  v_status := case when NEW.project_id is not null then 'issued'::public.lot_status else 'open'::public.lot_status end;

  -- (0) Job-work completed-goods receipt: one or more lots produced from a
  -- specific job_work_lines row, parented to the raw lot that was consumed.
  if NEW.jw_line_id is not null then
    select * into v_jwline from public.job_work_lines where id = NEW.jw_line_id;

    if v_track = 'item' and NEW.qty_received = floor(NEW.qty_received)
       and NEW.qty_received > 0 and NEW.qty_received <= 1000 then
      v_n := NEW.qty_received::int;
    else
      v_n := 1;
    end if;

    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      v_piece_qty := case when v_n > 1 then 1 else NEW.qty_received end;
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id, parent_lot_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
        container_no, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id, v_jwline.raw_lot_id,
        0, v_piece_qty, NEW.unit_cost,
        case when v_track = 'item' then true else coalesce(v_is_ser, false) end,
        v_status, 'completed'::public.jw_stage, NEW.location,
        case when v_track = 'box' then v_code else null end, NEW.created_by)
      returning id into v_lot;
      if NEW.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, NEW.mpn_id, v_piece_qty, NEW.created_by);
      end if;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, NEW.component_id, 'receipt', v_piece_qty, NEW.project_id,
        'grn', NEW.id, NEW.created_by, NEW.created_by);
      v_last := v_lot;
    end loop;

    update public.job_work_lines
       set qty_returned = coalesce(qty_returned, 0) + NEW.qty_received,
           completed_lot_id = v_last
     where id = NEW.jw_line_id;

    select coalesce(sum(qty_sent), 0), coalesce(sum(qty_returned), 0)
      into v_total_sent, v_total_ret
      from public.job_work_lines where jw_order_id = v_jwline.jw_order_id;
    update public.job_work_orders
       set status = case when v_total_ret >= v_total_sent then 'received' else 'partial' end
     where id = v_jwline.jw_order_id;

    return NEW;
  end if;

  -- (a) Add-to-existing-box: no new lot, just a receipt movement into the
  -- chosen box. Unlike location (which a box only ever has one of), a box
  -- CAN genuinely hold more than one MPN — record/accumulate this receipt's
  -- MPN in the box's breakdown instead of leaving it untouched.
  if NEW.target_lot_id is not null then
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (NEW.target_lot_id, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
      'grn', NEW.id, NEW.created_by, NEW.created_by);
    if NEW.mpn_id is not null then
      insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
      values (NEW.target_lot_id, NEW.mpn_id, NEW.qty_received, NEW.created_by)
      on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
    end if;
    return NEW;
  end if;

  -- (b) Item tracking: one lot (one QR) per physical piece.
  if v_track = 'item' and NEW.qty_received = floor(NEW.qty_received)
     and NEW.qty_received > 0 and NEW.qty_received <= 1000 then
    v_n := NEW.qty_received::int;
    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
        0, 1, NEW.unit_cost, true, v_status, v_stage, NEW.location, NEW.created_by)
      returning id into v_lot;
      if NEW.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, NEW.mpn_id, 1, NEW.created_by);
      end if;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, NEW.component_id, 'receipt', 1, NEW.project_id,
        'grn', NEW.id, NEW.created_by, NEW.created_by);
    end loop;
    return NEW;
  end if;

  -- (c) Box / bulk (default): one lot for the whole receipt.
  v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.inventory_lots(
    lot_code, component_id, grn_line_id, vendor_id, project_id,
    qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
    container_no, created_by)
  values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
    0, NEW.qty_received, NEW.unit_cost, coalesce(v_is_ser, false), v_status, v_stage, NEW.location,
    case when v_track = 'box' then v_code else null end, NEW.created_by)
  returning id into v_lot;
  if NEW.mpn_id is not null then
    insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
    values (v_lot, NEW.mpn_id, NEW.qty_received, NEW.created_by);
  end if;
  insert into public.stock_movements(
    lot_id, component_id, movement_type, qty, project_id,
    reference_type, reference_id, performed_by, created_by)
  values (v_lot, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
    'grn', NEW.id, NEW.created_by, NEW.created_by);
  return NEW;
end; $$;

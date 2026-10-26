-- Dispatch to client.
--
-- A dispatch takes material that was consumed into a project (WIP) and records
-- it as sent to the client, together with the finished good(s) it went into.
-- It moves no stock: the lots are already consumed. Each dispatch line points
-- at the actual lot the consumed material came from (oldest consumption
-- first), so a finished good's QR traces down to lots, GRNs, POs and vendors.
--
-- Dispatch never undoes consumption: the project still counts the material
-- as issued/used (shortfall, BOM status, reservations and reports are
-- unchanged). Only the value splits: WIP = consumed - dispatched.

create sequence if not exists public.seq_dispatch_no;

create or replace function public.next_dispatch_no()
 returns text language sql set search_path to 'public'
as $$ select 'DSP/' || public.fiscal_year_label() || '/' || lpad(nextval('public.seq_dispatch_no')::text, 4, '0') $$;

create table if not exists public.dispatches (
  id            uuid primary key default gen_random_uuid(),
  dispatch_no   text not null unique,
  project_id    uuid not null references public.projects(id),
  dispatch_date date not null default current_date,
  challan_no    text,
  vehicle_no    text,
  status        text not null default 'dispatched' check (status in ('dispatched', 'cancelled')),
  cancel_reason text,
  cancelled_by  uuid references public.profiles(id),
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz
);

create table if not exists public.dispatch_lines (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches(id) on delete cascade,
  component_id uuid not null references public.components(id),
  lot_id       uuid not null references public.inventory_lots(id),
  qty          numeric not null check (qty > 0),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id)
);
create index if not exists dispatch_lines_dispatch_idx on public.dispatch_lines(dispatch_id);
create index if not exists dispatch_lines_lot_idx on public.dispatch_lines(lot_id);
create index if not exists dispatches_project_idx on public.dispatches(project_id);

alter table public.dispatches enable row level security;
alter table public.dispatch_lines enable row level security;
-- Read for everyone signed in; writes only through create_dispatch / cancel_dispatch.
create policy dispatches_sel on public.dispatches for select to authenticated using (true);
create policy dispatch_lines_sel on public.dispatch_lines for select to authenticated using (true);

create trigger trg_dispatches_updated before update on public.dispatches
  for each row execute function public.set_updated_at();
create trigger trg_audit_dispatches after insert or update or delete on public.dispatches
  for each row execute function public.log_audit_event();

-- Finished goods belong to a project and, once shipped, to a dispatch.
alter table public.finished_goods
  add column if not exists project_id  uuid references public.projects(id),
  add column if not exists dispatch_id uuid references public.dispatches(id);
update public.finished_goods fg set project_id = li.project_id
  from public.project_line_items li where li.id = fg.project_line_item_id and fg.project_id is null;

-- "Dispatched" only through a dispatch, never by hand.
create or replace function public.finished_goods_guard_dispatch()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.status = 'dispatched' and new.dispatch_id is null then
    raise exception 'A finished good is marked dispatched by dispatching it to the client from the project''s Materials issued tab.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_finished_goods_guard_dispatch on public.finished_goods;
create trigger trg_finished_goods_guard_dispatch before insert or update on public.finished_goods
  for each row execute function public.finished_goods_guard_dispatch();

-- log_finished_goods records the project too.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.log_finished_goods(uuid, uuid, uuid, text, integer, public.fg_status, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$    insert into public.finished_goods(
      project_line_item_id, product_id, custom_name, serial_no, status, variant_selections, created_by)
    values (
      p_project_line_item_id, v_product,$s$,
    $s$    insert into public.finished_goods(
      project_id, project_line_item_id, product_id, custom_name, serial_no, status, variant_selections, created_by)
    values (
      p_project_id, p_project_line_item_id, v_product,$s$);
  if v_new = v_def then raise exception 'log_finished_goods: insert pattern not found'; end if;
  execute v_new;
end $$;

-- ---------- quantities ----------
-- Consumed per project and lot (real consumption, not job-work dispatch).
create or replace view public.v_project_lot_consumed
with (security_invoker = true) as
select m.project_id, m.lot_id, m.component_id, sum(-m.qty) as consumed_qty, min(m.performed_at) as first_at
  from public.stock_movements m
 where m.movement_type in ('issue'::public.movement_type, 'return'::public.movement_type)
   and m.project_id is not null
   and m.reference_type is distinct from 'job_work'
 group by m.project_id, m.lot_id, m.component_id;

-- Dispatched per project and lot (active dispatches only).
create or replace view public.v_project_lot_dispatched
with (security_invoker = true) as
select d.project_id, dl.lot_id, dl.component_id, sum(dl.qty) as dispatched_qty
  from public.dispatch_lines dl
  join public.dispatches d on d.id = dl.dispatch_id
 where d.status = 'dispatched'
 group by d.project_id, dl.lot_id, dl.component_id;

-- Dispatched per project and component, valued like WIP (same per-lot rate).
create or replace view public.v_project_dispatched
with (security_invoker = true) as
select x.project_id, x.component_id, sum(x.dispatched_qty) as dispatched_qty, sum(x.dispatched_qty * r.rate) as dispatched_value
  from public.v_project_lot_dispatched x
  join public.v_lot_rates r on r.lot_id = x.lot_id
 group by x.project_id, x.component_id;

-- Costing: consumed_value stays "total used"; wip_value = consumed - dispatched.
create or replace view public.v_project_costing
with (security_invoker = true) as
select p.id as project_id,
       p.project_no,
       p.status,
       p.customer_po_value,
       coalesce(o.ordered_value, 0::numeric) as ordered_value,
       coalesce(r.received_value, 0::numeric) as received_value,
       coalesce(c.consumed_value, 0::numeric) as consumed_value,
       coalesce(dv.dispatched_value, 0::numeric) as dispatched_value,
       coalesce(c.consumed_value, 0::numeric) - coalesce(dv.dispatched_value, 0::numeric) as wip_value
  from public.projects p
  left join (
    select po_lines.project_id, sum(po_lines.amount) as ordered_value
      from public.po_lines
     where po_lines.project_id is not null and po_lines.line_status <> 'cancelled'::public.po_line_status
     group by po_lines.project_id
  ) o on o.project_id = p.id
  left join (
    select gl.project_id,
           sum(gl.qty_received * case
                 when gl.jw_line_id is not null then coalesce(jl.jw_rate, jc.jw_rate, 0)
                 else coalesce(pl.rate, gl.unit_cost, 0)
               end) as received_value
      from public.grn_lines gl
      left join public.po_lines pl
        on pl.id = gl.po_line_id and pl.approval_status = 'approved'::public.po_line_approval_status
      left join public.job_work_lines jl on jl.id = gl.jw_line_id
      left join public.components jc on jc.id = jl.component_id
     where gl.project_id is not null
     group by gl.project_id
  ) r on r.project_id = p.id
  left join (
    select v_project_consumption.project_id, sum(v_project_consumption.consumption_value) as consumed_value
      from public.v_project_consumption
     group by v_project_consumption.project_id
  ) c on c.project_id = p.id
  left join (
    select project_id, sum(dispatched_value) as dispatched_value from public.v_project_dispatched group by project_id
  ) dv on dv.project_id = p.id;

-- A consumption can't be reversed below what has already been dispatched from that lot.
create or replace function public.movements_guard_dispatched()
 returns trigger language plpgsql set search_path to 'public'
as $$
declare v_consumed numeric; v_dispatched numeric;
begin
  if new.movement_type = 'return' and new.project_id is not null then
    select coalesce(sum(consumed_qty), 0) into v_consumed from public.v_project_lot_consumed
     where project_id = new.project_id and lot_id = new.lot_id;
    select coalesce(sum(dispatched_qty), 0) into v_dispatched from public.v_project_lot_dispatched
     where project_id = new.project_id and lot_id = new.lot_id;
    if v_consumed - new.qty < v_dispatched - 1e-9 then
      raise exception 'This material has already been dispatched to the client — cancel the dispatch first.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_movements_guard_dispatched on public.stock_movements;
create trigger trg_movements_guard_dispatched before insert on public.stock_movements
  for each row execute function public.movements_guard_dispatched();

-- ---------- create / cancel ----------
create or replace function public.create_dispatch(
  p_project uuid,
  p_items   jsonb,          -- [{component_id, qty}]
  p_fg_ids  uuid[],         -- already-logged finished goods of this project to ship
  p_new_fg  jsonb,          -- {quantity, project_line_item_id | product_id | custom_name} or null
  p_date    date,
  p_challan text,
  p_vehicle text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    public.role := public.auth_role();
  v_id      uuid;
  v_no      text;
  v_item    record;
  v_lot     record;
  v_left    numeric;
  v_take    numeric;
  v_avail   numeric;
  v_comp    text;
  v_new_qty int := coalesce((p_new_fg->>'quantity')::int, 0);
  v_li      record;
  v_li_id   uuid;
  v_already int;
  v_product uuid;
  v_custom  text;
  v_variant jsonb;
  v_serials text[] := '{}';
  v_serial  text;
  v_n       int;
  i         int;
begin
  if v_role is null or v_role not in ('admin', 'team_lead') then
    raise exception 'Only Admin / Team Lead can dispatch to the client.' using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Pick at least one component to dispatch.';
  end if;
  if coalesce(array_length(p_fg_ids, 1), 0) = 0 and v_new_qty <= 0 then
    raise exception 'Pick or log at least one finished good for this dispatch.';
  end if;
  if v_new_qty < 0 or v_new_qty > 1000 then
    raise exception 'Number of finished goods must be between 1 and 1000.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dispatch:' || p_project::text, 0));

  v_no := public.next_dispatch_no();
  insert into public.dispatches(dispatch_no, project_id, dispatch_date, challan_no, vehicle_no, created_by)
  values (v_no, p_project, coalesce(p_date, current_date), nullif(trim(p_challan), ''), nullif(trim(p_vehicle), ''), v_actor)
  returning id into v_id;

  -- Components: take from the project's consumed lots, oldest consumption first.
  for v_item in select * from jsonb_to_recordset(p_items) as x(component_id uuid, qty numeric) loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception 'Every dispatched quantity must be more than 0.';
    end if;
    v_left := v_item.qty;
    for v_lot in
      select c.lot_id, c.consumed_qty - coalesce(d.dispatched_qty, 0) as avail
        from public.v_project_lot_consumed c
        left join public.v_project_lot_dispatched d on d.project_id = c.project_id and d.lot_id = c.lot_id
       where c.project_id = p_project and c.component_id = v_item.component_id
         and c.consumed_qty - coalesce(d.dispatched_qty, 0) > 1e-9
       order by c.first_at, c.lot_id
    loop
      exit when v_left <= 1e-9;
      v_take := least(v_lot.avail, v_left);
      insert into public.dispatch_lines(dispatch_id, component_id, lot_id, qty, created_by)
      values (v_id, v_item.component_id, v_lot.lot_id, v_take, v_actor);
      v_left := v_left - v_take;
    end loop;
    if v_left > 1e-9 then
      select coalesce(sum(c.consumed_qty - coalesce(d.dispatched_qty, 0)), 0) into v_avail
        from public.v_project_lot_consumed c
        left join public.v_project_lot_dispatched d on d.project_id = c.project_id and d.lot_id = c.lot_id
       where c.project_id = p_project and c.component_id = v_item.component_id;
      select component_no into v_comp from public.components where id = v_item.component_id;
      raise exception 'Only % of % is still in WIP for this project; you entered %.',
        trim_scale(v_avail + (v_item.qty - v_left)), coalesce(v_comp, 'this component'), trim_scale(v_item.qty);
    end if;
  end loop;

  -- Already-logged finished goods of this project.
  if coalesce(array_length(p_fg_ids, 1), 0) > 0 then
    update public.finished_goods
       set status = 'dispatched', dispatch_id = v_id
     where id = any(p_fg_ids) and project_id = p_project and dispatch_id is null;
    get diagnostics v_n = row_count;
    if v_n <> array_length(p_fg_ids, 1) then
      raise exception 'Some of the chosen finished goods are not on this project or have already been dispatched.';
    end if;
  end if;

  -- New finished goods, logged as part of this dispatch.
  if v_new_qty > 0 then
    if p_new_fg->>'project_line_item_id' is not null then
      select * into v_li from public.project_line_items where id = (p_new_fg->>'project_line_item_id')::uuid for update;
      if not found or v_li.project_id <> p_project then
        raise exception 'That line item is not on this project.';
      end if;
      select count(*) into v_already from public.finished_goods where project_line_item_id = v_li.id;
      if v_already + v_new_qty > v_li.quantity then
        raise exception 'Only % of % ordered on this line item are still unlogged.', greatest(v_li.quantity - v_already, 0), v_li.quantity;
      end if;
      v_li_id   := v_li.id;
      v_product := v_li.product_id;
      v_variant := v_li.variant_selections;
    else
      v_product := nullif(p_new_fg->>'product_id', '')::uuid;
      v_custom  := nullif(trim(p_new_fg->>'custom_name'), '');
      if (v_product is null) = (v_custom is null) then
        raise exception 'Give the finished good a product or a custom name.';
      end if;
    end if;
    for i in 1..v_new_qty loop
      v_serial := public.next_fg_no();
      insert into public.finished_goods(project_id, project_line_item_id, product_id, custom_name, serial_no, status,
                                        variant_selections, dispatch_id, created_by)
      values (p_project, v_li_id, v_product, case when v_li_id is null then v_custom end, v_serial, 'dispatched',
              v_variant, v_id, v_actor);
      v_serials := v_serials || v_serial;
    end loop;
  end if;

  select v_serials || coalesce(array_agg(serial_no order by serial_no), '{}') into v_serials
    from public.finished_goods where id = any(coalesce(p_fg_ids, '{}'));

  return jsonb_build_object('ok', true, 'id', v_id, 'dispatch_no', v_no, 'serials', to_jsonb(v_serials));
end $$;

create or replace function public.cancel_dispatch(p_dispatch uuid, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v_d record;
begin
  if coalesce(public.auth_role()::text, '') <> 'admin' or public.auth_is_factory_admin() then
    raise exception 'Only an Admin can cancel a dispatch.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason for cancelling.';
  end if;
  select * into v_d from public.dispatches where id = p_dispatch for update;
  if not found then raise exception 'Dispatch not found.'; end if;
  if v_d.status <> 'dispatched' then raise exception 'This dispatch is already cancelled.'; end if;

  update public.dispatches
     set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_dispatch;
  update public.finished_goods set status = 'ready', dispatch_id = null where dispatch_id = p_dispatch;
  return jsonb_build_object('ok', true, 'dispatch_no', v_d.dispatch_no);
end $$;

revoke execute on function public.create_dispatch(uuid, jsonb, uuid[], jsonb, date, text, text) from public, anon;
revoke execute on function public.cancel_dispatch(uuid, text) from public, anon;
grant execute on function public.create_dispatch(uuid, jsonb, uuid[], jsonb, date, text, text) to authenticated;
grant execute on function public.cancel_dispatch(uuid, text) to authenticated;

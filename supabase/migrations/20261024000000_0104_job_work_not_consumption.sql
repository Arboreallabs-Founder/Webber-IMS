-- Job work was counted twice in project value.
--
-- Dispatching a job-work order writes an 'issue' movement on the raw lot,
-- tagged to the project. v_project_consumption counted that as consumption
-- (WIP), and the completed lot that comes back is reserved (blocked) for the
-- same project at raw cost + job-work charge — so the raw value sat in WIP
-- and in Blocked at once, and in WIP twice once the completed lot was used.
-- project_shortfall, v_bom_variance and the project reports already ignore
-- the dispatch movement; this brings WIP, costing and auto-release in line.
--
-- Also: a returned lot's cost took the raw lot's GRN-typed unit_cost, which
-- is discontinued (and is null on new receipts). It is now the raw lot's PO
-- rate + the job-work charge.

-- 1. Per-lot rate. PO rate (own approved PO line, else the source lot's);
--    for a job-work return, the raw lot's rate + the job-work charge; the
--    legacy typed cost only where neither applies. jw_charge is the job-work
--    charge alone (null for non-job-work lots).
create or replace view public.v_lot_rates
with (security_invoker = true) as
with po as (
  select l.id, coalesce(pl.rate, spl.rate) as po_rate
    from public.inventory_lots l
    left join public.grn_lines gl on gl.id = l.grn_line_id
    left join public.po_lines pl
      on pl.id = gl.po_line_id and pl.approval_status = 'approved'::public.po_line_approval_status
    left join public.inventory_lots sl on sl.id = l.source_lot_id
    left join public.grn_lines sgl on sgl.id = sl.grn_line_id
    left join public.po_lines spl
      on spl.id = sgl.po_line_id and spl.approval_status = 'approved'::public.po_line_approval_status
), jw as (
  select l.id,
         coalesce(jl.jw_rate, c.jw_rate, 0) as charge,
         coalesce(rp.po_rate, r.unit_cost, 0) as raw_rate
    from public.inventory_lots l
    left join public.inventory_lots sl on sl.id = l.source_lot_id
    join public.grn_lines gl on gl.id = coalesce(l.grn_line_id, sl.grn_line_id)
    join public.job_work_lines jl on jl.id = gl.jw_line_id
    join public.components c on c.id = jl.component_id
    left join public.inventory_lots r on r.id = jl.raw_lot_id
    left join po rp on rp.id = r.id
)
select l.id as lot_id,
       l.component_id,
       l.status,
       l.jw_stage,
       l.qty_on_hand,
       coalesce(po.po_rate, jw.raw_rate + jw.charge, l.unit_cost) as rate,
       jw.charge as jw_charge
  from public.inventory_lots l
  left join po on po.id = l.id
  left join jw on jw.id = l.id;

-- 2. Consumption (WIP): real use only, not the job-work dispatch.
create or replace view public.v_project_consumption
with (security_invoker = true) as
select m.project_id,
       m.component_id,
       sum(-m.qty) as consumed_qty,
       sum(-m.qty * r.rate) as consumption_value
  from public.stock_movements m
  join public.v_lot_rates r on r.lot_id = m.lot_id
 where m.movement_type in ('issue'::public.movement_type, 'return'::public.movement_type)
   and m.project_id is not null
   and m.reference_type is distinct from 'job_work'
 group by m.project_id, m.component_id;

-- 3. Stock value per component, on the same per-lot rate.
create or replace view public.v_component_on_hand
with (security_invoker = true) as
select c.id as component_id,
       c.component_no,
       c.name,
       c.uom,
       coalesce(sum(l.qty_on_hand), 0::numeric) as qty_on_hand,
       coalesce(sum(l.qty_on_hand * r.rate), 0::numeric) as stock_value,
       count(l.id) filter (where l.status <> 'consumed'::public.lot_status) as lot_count,
       count(l.id) > 0 as has_stock_history
  from public.components c
  left join public.inventory_lots l on l.component_id = c.id
  left join public.v_lot_rates r on r.lot_id = l.id
 group by c.id, c.component_no, c.name, c.uom;

-- 4. Received value: a job-work GRN line adds only the job-work charge — the
--    raw material was already received on its own PO GRN.
create or replace view public.v_project_costing
with (security_invoker = true) as
select p.id as project_id,
       p.project_no,
       p.status,
       p.customer_po_value,
       coalesce(o.ordered_value, 0::numeric) as ordered_value,
       coalesce(r.received_value, 0::numeric) as received_value,
       coalesce(c.consumed_value, 0::numeric) as consumed_value
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
  ) c on c.project_id = p.id;

-- 5. Functions: auto-release must not treat a dispatch as consumption (it
--    would release the completed lot when it comes back), and a job-work
--    receipt is costed at the raw lot's PO rate + the charge.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public._auto_release(uuid, uuid, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$and movement_type in ('issue', 'return');$s$,
    $s$and movement_type in ('issue', 'return')
     and reference_type is distinct from 'job_work';$s$);
  if v_new = v_def then raise exception '_auto_release: pattern not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.receive_job_work(uuid, uuid, numeric, uuid, jsonb, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$v_cost := coalesce(v_raw.unit_cost, 0) + v_rate;$s$,
    $s$v_cost := coalesce((select r.rate from public.v_lot_rates r where r.lot_id = v_line.raw_lot_id), 0) + v_rate;$s$);
  if v_new = v_def then raise exception 'receive_job_work: pattern not found'; end if;
  execute v_new;
end $$;

-- 6. Correct the stored cost on job-work returns that took the typed raw cost.
update public.inventory_lots l
   set unit_cost = r.rate
  from public.v_lot_rates r
 where r.lot_id = l.id and r.jw_charge is not null and l.unit_cost is distinct from r.rate;

update public.grn_lines gl
   set unit_cost = r.rate
  from public.inventory_lots l
  join public.v_lot_rates r on r.lot_id = l.id
 where l.grn_line_id = gl.id and gl.jw_line_id is not null and r.jw_charge is not null
   and gl.unit_cost is distinct from r.rate;

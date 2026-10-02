-- READ-ONLY. Safe to run on the live database, before or after 0114.
-- Shows, per project + component, what 0114's auto-release would free the
-- first time it checks that project (after a consumption or a BOM
-- approval). Same rules as public._auto_release():
--   still needed = greatest(approved BOM qty, approved PO qty) - consumed
--   would free   = reserved - still needed (if > 0)
-- Job-work components and components with no BOM line and no PO line are
-- never freed automatically, so they're left out.
with reserved as (
  select project_id, component_id, sum(qty_on_hand) as reserved_qty
    from public.inventory_lots
   where status = 'issued' and qty_on_hand > 0 and project_id is not null and component_id is not null
   group by project_id, component_id
),
bom as (
  select b.project_id, bl.component_id, sum(bl.required_qty) as bom_qty
    from public.boms b join public.bom_lines bl on bl.bom_id = b.id
   where b.status = 'approved' and bl.component_id is not null
   group by b.project_id, bl.component_id
),
po as (
  select pl.project_id, pl.component_id, sum(pl.qty_ordered) as po_qty
    from public.po_lines pl join public.purchase_orders o on o.id = pl.po_id
   where pl.project_id is not null and pl.component_id is not null
     and pl.approval_status = 'approved' and pl.line_status <> 'cancelled'
     and o.status not in ('cancelled', 'superseded')
   group by pl.project_id, pl.component_id
),
consumed as (
  select project_id, component_id, sum(-qty) as consumed_qty
    from public.stock_movements
   where movement_type in ('issue', 'return') and project_id is not null
     and reference_type is distinct from 'job_work'
   group by project_id, component_id
)
select p.project_no,
       c.component_no, c.name,
       r.reserved_qty,
       coalesce(b.bom_qty, 0)      as bom_qty,
       coalesce(o.po_qty, 0)       as po_qty,
       coalesce(x.consumed_qty, 0) as consumed_qty,
       greatest(greatest(coalesce(b.bom_qty, 0), coalesce(o.po_qty, 0)) - coalesce(x.consumed_qty, 0), 0) as still_needed,
       r.reserved_qty - greatest(greatest(coalesce(b.bom_qty, 0), coalesce(o.po_qty, 0)) - coalesce(x.consumed_qty, 0), 0) as would_free
  from reserved r
  join public.components c on c.id = r.component_id
  join public.projects   p on p.id = r.project_id
  left join bom      b on b.project_id = r.project_id and b.component_id = r.component_id
  left join po       o on o.project_id = r.project_id and o.component_id = r.component_id
  left join consumed x on x.project_id = r.project_id and x.component_id = r.component_id
 where not coalesce(c.is_job_work, false)
   and (b.component_id is not null or o.component_id is not null)
   and r.reserved_qty > greatest(greatest(coalesce(b.bom_qty, 0), coalesce(o.po_qty, 0)) - coalesce(x.consumed_qty, 0), 0)
 order by p.project_no, c.component_no;

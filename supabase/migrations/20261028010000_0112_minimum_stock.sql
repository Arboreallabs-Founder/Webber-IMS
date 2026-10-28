-- Minimum stock.
--
-- components.reorder_level (never used until now) is the component's minimum
-- open stock, set in Master Data as "Minimum stock".
--
-- A component is short when
--   minimum - open stock - still on order for stock  > 0
-- where open stock is free shelf stock (lots with status 'open'; blocked and
-- consumed lots don't count) and "on order" is what is still to arrive on
-- stock PO lines (no project), drafts and POs awaiting approval included so a
-- PO raised from the Action Center takes the component off the list at once.

comment on column public.components.reorder_level is
  'Minimum open stock (Master Data "Minimum stock"); the Action Center lists components below it.';

create or replace view public.v_min_stock_shortfall
with (security_invoker = true) as
with open_stock as (
  select component_id, sum(qty_on_hand) as qty
    from public.inventory_lots
   where status = 'open' and qty_on_hand > 0
   group by component_id
), on_order as (
  select l.component_id, sum(greatest(l.qty_ordered - coalesce(l.qty_received, 0), 0)) as qty
    from public.po_lines l
    join public.purchase_orders po on po.id = l.po_id
   where l.project_id is null
     and l.line_status in ('pending', 'partial')
     and l.approval_status is distinct from 'rejected'
     and po.status in ('draft', 'pending_signature', 'sent', 'partial')
   group by l.component_id
)
select c.id as component_id,
       c.component_no,
       c.name as component_name,
       c.uom,
       c.is_consumable,
       c.reorder_level as min_qty,
       coalesce(o.qty, 0) as open_qty,
       coalesce(p.qty, 0) as on_order_qty,
       c.reorder_level - coalesce(o.qty, 0) - coalesce(p.qty, 0) as shortfall_qty
  from public.components c
  left join open_stock o on o.component_id = c.id
  left join on_order p on p.component_id = c.id
 where c.reorder_level > 0
   and c.reorder_level - coalesce(o.qty, 0) - coalesce(p.qty, 0) > 0;

grant select on public.v_min_stock_shortfall to authenticated;
revoke all on public.v_min_stock_shortfall from anon;

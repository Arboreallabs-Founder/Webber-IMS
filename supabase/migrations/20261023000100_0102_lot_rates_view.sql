-- Per-lot valuation rate, for screens that show a lot's "Unit cost". Same rule
-- as v_component_on_hand / v_project_consumption: the approved PO rate (own
-- GRN line, else the source lot's), and the legacy typed cost only where there
-- is no approved PO line (e.g. site purchases). The GRN-typed rate itself is
-- discontinued.
create or replace view public.v_lot_rates
with (security_invoker = true) as
select l.id as lot_id,
       l.component_id,
       l.status,
       l.jw_stage,
       l.qty_on_hand,
       coalesce(pl.rate, spl.rate, l.unit_cost) as rate
  from public.inventory_lots l
  left join public.grn_lines gl on gl.id = l.grn_line_id
  left join public.po_lines pl
    on pl.id = gl.po_line_id and pl.approval_status = 'approved'::public.po_line_approval_status
  left join public.inventory_lots sl on sl.id = l.source_lot_id
  left join public.grn_lines sgl on sgl.id = sl.grn_line_id
  left join public.po_lines spl
    on spl.id = sgl.po_line_id and spl.approval_status = 'approved'::public.po_line_approval_status;

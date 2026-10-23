-- The GRN-typed unit cost is discontinued (the input was removed from GRN
-- receiving); every valuation is at the approved PO rate. received_value was
-- the last figure still priced off grn_lines.unit_cost, so lines with no typed
-- cost counted as zero and "Received" fell below WIP. It now uses the same rule
-- as v_project_consumption / v_component_on_hand: approved PO rate first, the
-- legacy typed cost only where there is no approved PO line.
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
     where po_lines.project_id is not null
       and po_lines.line_status <> 'cancelled'::public.po_line_status
     group by po_lines.project_id
  ) o on o.project_id = p.id
  left join (
    select gl.project_id,
           sum(gl.qty_received * coalesce(pl.rate, gl.unit_cost, 0::numeric)) as received_value
      from public.grn_lines gl
      left join public.po_lines pl
        on pl.id = gl.po_line_id
       and pl.approval_status = 'approved'::public.po_line_approval_status
     where gl.project_id is not null
     group by gl.project_id
  ) r on r.project_id = p.id
  left join (
    select v_project_consumption.project_id,
           sum(v_project_consumption.consumption_value) as consumed_value
      from public.v_project_consumption
     group by v_project_consumption.project_id
  ) c on c.project_id = p.id;

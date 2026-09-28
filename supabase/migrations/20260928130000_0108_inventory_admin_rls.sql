-- ============================================================
-- 0108 — Grant the new inventory_admin role write access scoped to
-- exactly: components (+ its MPN/alternatives/supplier-tag child
-- tables), inventory_lots + stock_movements, grns + grn_lines, and
-- requisitions + requisition_lines. Every other masters table
-- (vendors, customers, categories, products, bom_templates,
-- bom_template_lines, product_variant_params) is left untouched —
-- still admin/team_lead only — so inventory_admin has no write path
-- into them either directly or through the shared upsertRecord/
-- deleteRecord helper (which now takes an explicit per-call
-- permission check; components passes canWriteComponents, everything
-- else keeps defaulting to canWriteMasters).
-- ============================================================

-- Components master + its child tables
drop policy components_mod on public.components;
create policy components_mod on public.components for all to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));

drop policy vendor_components_mod on public.vendor_components;
create policy vendor_components_mod on public.vendor_components for all to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));

drop policy component_mpns_mod on public.component_mpns;
create policy component_mpns_mod on public.component_mpns for all to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));

drop policy component_alternatives_mod on public.component_alternatives;
create policy component_alternatives_mod on public.component_alternatives for all to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));

-- Inventory
drop policy lots_mod on public.inventory_lots;
create policy lots_mod on public.inventory_lots for all to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));

drop policy mov_ins on public.stock_movements;
create policy mov_ins on public.stock_movements for insert to authenticated
  with check (public.auth_role() in ('admin','team_lead','team_member','inventory_admin'));

-- GRN
drop policy grns_ins on public.grns;
create policy grns_ins on public.grns for insert to authenticated
  with check (public.auth_role() in ('admin','team_lead','team_member','inventory_admin'));
drop policy grns_upd on public.grns;
create policy grns_upd on public.grns for update to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));
drop policy grns_del on public.grns;
create policy grns_del on public.grns for delete to authenticated
  using (public.auth_role() in ('admin','inventory_admin'));

drop policy grnline_ins on public.grn_lines;
create policy grnline_ins on public.grn_lines for insert to authenticated
  with check (public.auth_role() in ('admin','team_lead','team_member','inventory_admin'));
drop policy grnline_upd on public.grn_lines;
create policy grnline_upd on public.grn_lines for update to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));
drop policy grnline_del on public.grn_lines;
create policy grnline_del on public.grn_lines for delete to authenticated
  using (public.auth_role() in ('admin','inventory_admin'));

-- Requisitions
drop policy req_ins on public.requisitions;
create policy req_ins on public.requisitions for insert to authenticated
  with check (public.auth_role() in ('admin','team_lead','team_member','inventory_admin'));
drop policy req_upd on public.requisitions;
create policy req_upd on public.requisitions for update to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));
drop policy req_del on public.requisitions;
create policy req_del on public.requisitions for delete to authenticated
  using (public.auth_role() in ('admin','inventory_admin'));

drop policy reqline_ins on public.requisition_lines;
create policy reqline_ins on public.requisition_lines for insert to authenticated
  with check (public.auth_role() in ('admin','team_lead','team_member','inventory_admin'));
drop policy reqline_upd on public.requisition_lines;
create policy reqline_upd on public.requisition_lines for update to authenticated
  using (public.auth_role() in ('admin','team_lead','inventory_admin'))
  with check (public.auth_role() in ('admin','team_lead','inventory_admin'));
drop policy reqline_del on public.requisition_lines;
create policy reqline_del on public.requisition_lines for delete to authenticated
  using (public.auth_role() in ('admin','inventory_admin'));

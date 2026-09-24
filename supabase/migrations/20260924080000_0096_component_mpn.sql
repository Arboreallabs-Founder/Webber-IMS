-- ============================================================
-- 0096 — Manufacturer Part No. (MPN) on components, alongside the
-- internal WPC (component_no). Added to v_components_safe too so
-- non-financial roles can see/edit it.
-- ============================================================

alter table public.components add column mpn text;

drop view if exists public.v_components_safe;
create view public.v_components_safe
with (security_invoker = true) as
select
  id, component_no, mpn, name, description, uom, type, quantity_type, tracking_mode,
  is_serialized, is_assembly, parent_assembly_id, is_job_work, raw_supplier_id, jw_vendor_id,
  inspection_template_id,
  grade, spec, od_mm, id_mm, thk_mm, width_mm, length_mm, nominal_size,
  by_weight, weight_uom, cut_from_plate, original_description,
  reorder_level, created_at, updated_at, created_by
from public.components;
grant select on public.v_components_safe to authenticated;

-- ============================================================
-- 0099 — Corrects 0098. One component = one WPC (unique again), and
-- MPN moves off components onto its own child table instead of
-- forking a new component row per manufacturer: the same WPC can be
-- sourced from more than one manufacturer, each with its own MPN, so
-- a component now carries a *list* of MPNs rather than a single one.
-- ============================================================

create table public.component_mpns (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  mpn          text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  unique (mpn)
);
alter table public.component_mpns enable row level security;
create index idx_component_mpns_component on public.component_mpns(component_id);

create policy component_mpns_sel on public.component_mpns for select to authenticated using (true);
create policy component_mpns_mod on public.component_mpns for all to authenticated
  using (public.auth_role() in ('admin','team_lead'))
  with check (public.auth_role() in ('admin','team_lead'));
grant select, insert, update, delete on public.component_mpns to authenticated;

-- Carry over whatever MPNs the short-lived column-based design already collected.
insert into public.component_mpns (component_id, mpn, created_by)
select id, trim(mpn), created_by from public.components
where mpn is not null and trim(mpn) <> '';

-- v_components_safe selects the mpn column, so it must go before the drop.
drop view if exists public.v_components_safe;
alter table public.components drop column mpn;

-- 0098 dropped this to let WPC repeat across manufacturer-specific component
-- rows; component_mpns above replaces that model, so WPC goes back to being
-- the one thing that uniquely names a component.
alter table public.components add constraint components_component_no_key unique (component_no);

create view public.v_components_safe
with (security_invoker = true) as
select
  id, component_no, name, description, uom, type, quantity_type, tracking_mode,
  is_serialized, is_assembly, parent_assembly_id, is_job_work, raw_supplier_id, jw_vendor_id,
  inspection_template_id,
  grade, spec, od_mm, id_mm, thk_mm, width_mm, length_mm, nominal_size,
  by_weight, weight_uom, cut_from_plate, original_description,
  reorder_level, created_at, updated_at, created_by
from public.components;
grant select on public.v_components_safe to authenticated;

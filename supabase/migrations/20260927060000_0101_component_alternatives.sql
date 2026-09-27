-- ============================================================
-- 0101 — Approved alternatives: components that can substitute for
-- each other. Deliberately symmetric — marking B as an alternative
-- for A always stores both (A,B) and (B,A), so a simple lookup by
-- either side returns the full set without an OR/UNION at read time.
-- ============================================================

create table public.component_alternatives (
  id             uuid primary key default gen_random_uuid(),
  component_id   uuid not null references public.components(id) on delete cascade,
  alternative_id uuid not null references public.components(id) on delete cascade,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  unique (component_id, alternative_id),
  check (component_id <> alternative_id)
);
alter table public.component_alternatives enable row level security;
create index idx_component_alternatives_component on public.component_alternatives(component_id);
create index idx_component_alternatives_alternative on public.component_alternatives(alternative_id);

create policy component_alternatives_sel on public.component_alternatives for select to authenticated using (true);
create policy component_alternatives_mod on public.component_alternatives for all to authenticated
  using (public.auth_role() in ('admin','team_lead'))
  with check (public.auth_role() in ('admin','team_lead'));
grant select, insert, update, delete on public.component_alternatives to authenticated;

-- "No BOM needed" becomes its own checkbox (projects.bom_not_needed) instead of
-- a third bom_policy value, so unticking it puts a project back exactly as it
-- was: 'legacy' projects stay legacy, new ('required') ones are locked again
-- until their BOM is approved. Only a full Admin can tick or untick it.

alter table public.projects add column if not exists bom_not_needed boolean not null default false;
update public.projects set bom_not_needed = true, bom_policy = 'required' where bom_policy = 'not_needed';

alter table public.projects drop constraint if exists projects_bom_policy_check;
alter table public.projects add constraint projects_bom_policy_check check (bom_policy in ('required', 'legacy'));

create or replace function public.project_bom_ready(p_project uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select coalesce((
    select pr.bom_not_needed
        or pr.bom_policy <> 'required'
        or exists (select 1 from public.boms b where b.project_id = pr.id and b.first_approved_at is not null)
      from public.projects pr where pr.id = p_project), true)
$$;

create or replace function public.projects_guard_bom_policy()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if (new.bom_policy is distinct from old.bom_policy or new.bom_not_needed is distinct from old.bom_not_needed)
     and auth.uid() is not null
     and (coalesce(public.auth_role()::text, '') <> 'admin' or public.auth_is_factory_admin()) then
    raise exception 'Only an Admin can change whether a project needs a BOM.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_guard_bom_policy on public.projects;
create trigger trg_projects_guard_bom_policy before update of bom_policy, bom_not_needed on public.projects
  for each row execute function public.projects_guard_bom_policy();

-- New projects need an approved BOM before anything is ordered, blocked or
-- consumed for them.
--
-- projects.bom_policy:
--   'required'   — new projects (the default). POs, blocking stock, consumption
--                  and job-work dispatch for the project are refused until its
--                  BOM has been approved at least once.
--   'not_needed' — a full Admin ticked "No BOM needed" (consumables, fixed
--                  assets and other internal projects with no product).
--   'legacy'     — every project that existed before this change; works as
--                  before. The app shows an "Add a BOM" banner when it has none.
--
-- "Approved at least once" (boms.first_approved_at), so a BOM being revised
-- (back to draft / waiting for approval) doesn't stop the floor.

alter table public.projects
  add column if not exists bom_policy text not null default 'required'
    check (bom_policy in ('required', 'not_needed', 'legacy'));
update public.projects set bom_policy = 'legacy';

alter table public.boms add column if not exists first_approved_at timestamptz;
update public.boms set first_approved_at = coalesce(approved_at, now())
 where status = 'approved' and first_approved_at is null;

-- Approval guard (0106) now also stamps the first approval, and never lets it be cleared.
create or replace function public.boms_guard_approval()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $$
begin
  if new.status::text = 'approved' and (tg_op = 'INSERT' or old.status::text <> 'approved') then
    if auth.uid() is not null
       and (coalesce(public.auth_role()::text, '') not in ('admin', 'team_lead') or public.auth_is_factory_admin()) then
      raise exception 'Only an Admin or Team Lead can approve a BOM — submit it for approval instead.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.first_approved_at is not null then
    new.first_approved_at := old.first_approved_at;
  elsif new.status::text = 'approved' and new.first_approved_at is null then
    new.first_approved_at := coalesce(new.approved_at, now());
  end if;
  return new;
end $$;

create or replace function public.project_bom_ready(p_project uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select coalesce((
    select pr.bom_policy <> 'required'
        or exists (select 1 from public.boms b where b.project_id = pr.id and b.first_approved_at is not null)
      from public.projects pr where pr.id = p_project), true)
$$;

create or replace function public.assert_project_bom_ready(p_project uuid, p_what text)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $$
declare v_no text;
begin
  if p_project is null or public.project_bom_ready(p_project) then return; end if;
  select project_no into v_no from public.projects where id = p_project;
  raise exception '% needs an approved BOM before you can %. Get its BOM approved, or ask an Admin to mark it "No BOM needed".',
    coalesce(v_no, 'This project'), p_what
    using errcode = 'check_violation';
end $$;

revoke execute on function public.project_bom_ready(uuid) from anon;
revoke execute on function public.assert_project_bom_ready(uuid, text) from anon;

-- 1. Raising a PO line for the project.
create or replace function public.po_lines_require_bom()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.project_id is not null and (tg_op = 'INSERT' or new.project_id is distinct from old.project_id) then
    perform public.assert_project_bom_ready(new.project_id, 'raise a PO for it');
  end if;
  return new;
end $$;
drop trigger if exists trg_po_lines_require_bom on public.po_lines;
create trigger trg_po_lines_require_bom before insert or update of project_id on public.po_lines
  for each row execute function public.po_lines_require_bom();

-- 2. Blocking stock for the project (a lot or slice becoming reserved for it).
create or replace function public.lots_require_bom()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.status = 'issued' and new.project_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'issued' or old.project_id is distinct from new.project_id) then
    perform public.assert_project_bom_ready(new.project_id, 'block stock for it');
  end if;
  return new;
end $$;
drop trigger if exists trg_lots_require_bom on public.inventory_lots;
create trigger trg_lots_require_bom before insert or update of status, project_id on public.inventory_lots
  for each row execute function public.lots_require_bom();

-- 3. Consuming stock into the project (WIP), or sending material for its job work.
create or replace function public.movements_require_bom()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.movement_type = 'issue' and new.project_id is not null then
    perform public.assert_project_bom_ready(new.project_id,
      case when new.reference_type = 'job_work' then 'send material for job work for it' else 'consume stock for it' end);
  end if;
  return new;
end $$;
drop trigger if exists trg_movements_require_bom on public.stock_movements;
create trigger trg_movements_require_bom before insert on public.stock_movements
  for each row execute function public.movements_require_bom();

-- Only a full Admin can change a project's BOM policy.
create or replace function public.projects_guard_bom_policy()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.bom_policy is distinct from old.bom_policy and auth.uid() is not null
     and (coalesce(public.auth_role()::text, '') <> 'admin' or public.auth_is_factory_admin()) then
    raise exception 'Only an Admin can change whether a project needs a BOM.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_projects_guard_bom_policy on public.projects;
create trigger trg_projects_guard_bom_policy before update of bom_policy on public.projects
  for each row execute function public.projects_guard_bom_policy();

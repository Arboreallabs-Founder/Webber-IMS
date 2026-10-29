-- Factory Admin: an Admin who cannot approve project BOMs, edit Approval
-- Rights or manage users. Built as a flag on an 'admin' profile rather than a
-- new role, so every other Admin permission (≈100 role checks across RLS,
-- RPCs and the app) carries over untouched.
--
-- Project BOMs gain a "waiting for approval" step: a Factory Admin submits,
-- a full Admin (or Team Lead) approves or sends it back.

alter table public.profiles
  add column if not exists is_factory_admin boolean not null default false;

create or replace function public.auth_is_factory_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$ select coalesce((select is_factory_admin from public.profiles where id = auth.uid()), false) $$;

revoke execute on function public.auth_is_factory_admin() from anon;

-- ---------- BOM approval ----------
alter type public.bom_status add value if not exists 'pending_approval' after 'draft';

alter table public.boms
  add column if not exists submitted_by uuid references public.profiles(id),
  add column if not exists submitted_at timestamptz,
  add column if not exists review_note text;

-- The backstop: only an Admin or Team Lead who is not a Factory Admin can
-- move a BOM to approved. Before this, any role that can edit BOMs (incl.
-- Team Member) could set it through the API. Server-side contexts with no
-- signed-in user (migrations, maintenance) are unaffected.
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
  return new;
end $$;

drop trigger if exists trg_boms_guard_approval on public.boms;
create trigger trg_boms_guard_approval
  before insert or update on public.boms
  for each row execute function public.boms_guard_approval();

-- ---------- Approval Rights and user management: full Admins only ----------
drop policy if exists aright_mod on public.approval_rights;
create policy aright_mod on public.approval_rights for all to authenticated
  using (public.auth_role() = 'admin'::public.role and not public.auth_is_factory_admin())
  with check (public.auth_role() = 'admin'::public.role and not public.auth_is_factory_admin());

drop policy if exists profiles_mod on public.profiles;
create policy profiles_mod on public.profiles for all to authenticated
  using (public.auth_role() = 'admin'::public.role and not public.auth_is_factory_admin())
  with check (public.auth_role() = 'admin'::public.role and not public.auth_is_factory_admin());

-- Users screen: show the Factory Admin flag; full Admins only.
drop function if exists public.admin_list_users();
create function public.admin_list_users()
 returns table(id uuid, email text, full_name text, role public.role, is_factory_admin boolean, is_active boolean, created_at timestamptz)
 language sql
 stable security definer
 set search_path to 'public', 'auth'
as $function$
  select p.id, u.email::text, p.full_name, p.role, p.is_factory_admin, p.is_active, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.auth_role() = 'admin' and not public.auth_is_factory_admin()
  order by p.created_at;
$function$;
revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

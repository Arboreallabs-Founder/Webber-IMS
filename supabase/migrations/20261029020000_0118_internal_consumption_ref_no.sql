-- ============================================================
-- 0118 — Internal consumption reference no. is generated, not typed.
--
-- Internal consumption records are project rows with is_internal = true,
-- and their "Reference No." is projects.project_no. It used to be typed in
-- by hand. Now it is IC/<fiscal year>/<4-digit no.> — same style as
-- REQ/GRN/DSP — set by the database on insert and never changed after.
-- Customer projects keep their typed project no.
-- ============================================================

create sequence if not exists public.seq_ic_no;

create or replace function public.next_ic_no() returns text
  language sql set search_path = public as $$
  select 'IC/' || public.fiscal_year_label() || '/' || lpad(nextval('public.seq_ic_no')::text, 4, '0'); $$;

-- Insert: always take the next number, whatever was sent.
-- Update: the number can't change, and a record can't switch between
-- internal and customer project (that would orphan or forge a number).
create or replace function public.projects_internal_ref_no()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_internal then
      new.project_no := public.next_ic_no();
    end if;
  elsif old.is_internal or new.is_internal then
    new.project_no := old.project_no;
    new.is_internal := old.is_internal;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_internal_ref_no on public.projects;
create trigger trg_projects_internal_ref_no
  before insert or update on public.projects
  for each row execute function public.projects_internal_ref_no();

grant usage on sequence public.seq_ic_no to authenticated;
grant execute on function public.next_ic_no() to authenticated;
revoke execute on function public.next_ic_no() from anon, public;

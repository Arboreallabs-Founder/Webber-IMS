-- Inventory Floor ('floor') may: create GRNs and receive lines against POs,
-- receive job work, submit inspections (IRNs), raise requisitions, and consume
-- stock against a requisition. Nothing else — no PO/job-work creation, no
-- masters, no projects, no lot edits. Each grant below mirrors the existing
-- team_member grant for that one path.

alter policy grns_ins on public.grns
  with check (auth_role() = any (array['admin','team_lead','team_member','floor']::public.role[]));

alter policy grnline_ins on public.grn_lines
  with check (auth_role() = any (array['admin','team_lead','team_member','floor']::public.role[]));

alter policy req_ins on public.requisitions
  with check (auth_role() = any (array['admin','team_lead','team_member','floor']::public.role[]));

alter policy reqline_ins on public.requisition_lines
  with check (auth_role() = any (array['admin','team_lead','team_member','floor']::public.role[]));

-- These SECURITY DEFINER RPCs carry their own role allowlist. Rewrite only that
-- allowlist in the live definition, and fail loudly unless it occurs exactly
-- once, so a drifted body can't be silently half-patched.
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('consume_from_lot', $q$('admin', 'team_lead', 'team_member')$q$, $q$('admin', 'team_lead', 'team_member', 'floor')$q$),
      ('receive_job_work', $q$('admin','team_lead','team_member')$q$,   $q$('admin','team_lead','team_member','floor')$q$),
      ('submit_irn',       $q$('admin','team_lead','team_member')$q$,   $q$('admin','team_lead','team_member','floor')$q$)
    ) as t(fn, old_list, new_list)
  loop
    select pg_get_functiondef(p.oid) into strict v_def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = r.fn;

    if (length(v_def) - length(replace(v_def, r.old_list, ''))) / length(r.old_list) <> 1 then
      raise exception '%: expected exactly one role allowlist %', r.fn, r.old_list;
    end if;

    v_new := replace(v_def, r.old_list, r.new_list);
    execute v_new;
  end loop;
end $$;

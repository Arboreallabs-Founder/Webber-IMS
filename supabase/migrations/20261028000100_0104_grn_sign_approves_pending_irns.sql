-- ============================================================
-- 0104 — An Admin / Team Lead signing a GRN also approves every inspection
-- (IRN) still pending on it, under their name and with the same signature.
--
-- Material that needs inspection only becomes a GRN line once its IRN is
-- approved. Admins' own IRNs are approved the moment they submit them, but a
-- Floor user's wait for someone to approve them separately — so a GRN could
-- be fully signed while its material still sat in pending IRNs, printing
-- with "No lines." Signing is now that approval.
--
--   * Only when the signer can approve IRNs (admin / team_lead, the same
--     rule approve_irn enforces). The Floor creator signing slot 1 approves
--     nothing.
--   * Only the IRNs pending at the moment of signing — anything submitted
--     after a GRN is signed still needs approving the normal way.
--   * All-or-nothing: if any approval fails, the signature is rolled back
--     too, so a GRN is never left signed with some inspections skipped.
--   * Existing signed GRNs with pending IRNs are untouched (by request) —
--     those are approved individually.
-- ============================================================

create or replace function public.sign_grn(p_grn_id uuid, p_signature_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res     jsonb;
  v_role    public.role;
  v_irn     record;
  v_appr    jsonb;
  v_n       int := 0;
begin
  -- Signature first: if the signer isn't allowed to sign this slot, nothing
  -- else happens.
  v_res := public._record_signature('grn', p_grn_id, p_signature_id, p_actor);
  if v_res ? 'error' then return v_res; end if;

  select role into v_role from public.profiles where id = p_actor;
  if v_role in ('admin', 'team_lead') then
    for v_irn in
      select id, irn_no from public.irns
       where grn_id = p_grn_id and status = 'pending_approval'
       order by created_at
       for update
    loop
      v_appr := public.approve_irn(v_irn.id, p_actor, p_signature_id, 'Approved by signing the GRN');
      if v_appr ? 'error' then
        -- Undo the signature and any approvals already made in this call.
        raise exception 'Could not approve inspection %: %', v_irn.irn_no, v_appr->>'error';
      end if;
      v_n := v_n + 1;
    end loop;
  end if;

  return v_res || jsonb_build_object('irns_approved', v_n);
end; $function$;
revoke all on function public.sign_grn(uuid, uuid, uuid) from public, anon;
grant execute on function public.sign_grn(uuid, uuid, uuid) to authenticated;

-- ============================================================
-- 0101 — Removing an approver from Approval Rights no longer breaks the
-- documents they already signed, or strands GRNs that were waiting on them.
--
-- Required slots are derived live from approval_rights, and
-- document_fully_signed() demanded the signed slots EQUAL the required ones.
-- So removing, say, the slot-2 approver turned every document they had
-- signed ({1,2,3} vs required {1,3}) back into "not fully signed" — and no
-- one could ever sign it complete again. The app-side check in
-- src/lib/signatures.ts was already "every required slot is signed"; this
-- brings the database in line with it.
--
-- Separately, a GRN's pending lines only become stock when a signature lands
-- (0096). If removing an approver is what completes a GRN, no signature ever
-- lands, so those lines would sit unprocessed forever. A trigger on
-- approval_rights now runs the same sweep.
-- ============================================================

-- ---- fully signed = every required slot has a signature; extra (signed
-- before their approver was removed) slots are fine ----------------------
create or replace function public.document_fully_signed(p_document_type text, p_document_id uuid)
returns boolean
language sql stable security definer set search_path to 'public' as $$
  select
    (select array(
       select distinct s from unnest(
         array[1::smallint] ||
         coalesce((select array_agg(approver_order) from public.approval_rights where document_type = p_document_type), array[]::smallint[])
       ) as s
     ))
    <@
    coalesce(
      (select array_agg(distinct slot) from public.document_signatures
         where document_type = p_document_type and document_id = p_document_id),
      array[]::smallint[]
    );
$$;
grant execute on function public.document_fully_signed(text, uuid) to authenticated;

-- ---- removing / reassigning a GRN approver: process any GRN that is now
-- fully signed but still has lines waiting (process_grn_line is locked +
-- idempotent, so re-running it over already-processed lines is a no-op) ----
create or replace function public.approval_rights_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.document_type = 'grn' then
    perform public.process_grn_line(gl.id)
       from public.grn_lines gl
      where gl.processed_at is null
        and public.document_fully_signed('grn', gl.grn_id);
  end if;
  return null;
end;
$$;
revoke all on function public.approval_rights_after_change() from public, anon;

drop trigger if exists approval_rights_after_change on public.approval_rights;
create trigger approval_rights_after_change
  after update or delete on public.approval_rights
  for each row execute function public.approval_rights_after_change();

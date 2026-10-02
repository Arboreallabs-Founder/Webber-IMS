-- ============================================================
-- 0113 — req_status was defined with ('open','partially_ordered',
-- 'ordered','closed'), but every actual write path — issue_requisition()
-- (0027, rewritten 0068) and the manual status dropdown in
-- requisition-editor.tsx — has only ever used 'open', 'partially_issued',
-- 'issued', 'closed'. 'partially_ordered'/'ordered' are never written by
-- any code path; 'issued'/'partially_issued' were missing from the enum
-- entirely, so any requisition that actually got stock allocated against
-- it (via "Block stock for BOM" or "Issue" on the requisition page)
-- failed outright with "invalid input value for enum req_status" the
-- moment issue_requisition tried to write the real result of the
-- allocation. Every requisition in the live DB is stuck at 'open' as a
-- result. Add the two missing values; 'partially_ordered'/'ordered' are
-- left in place (harmless, just unused) rather than removed, since
-- dropping enum values requires recreating the type.
-- ============================================================

alter type public.req_status add value 'issued';
alter type public.req_status add value 'partially_issued';

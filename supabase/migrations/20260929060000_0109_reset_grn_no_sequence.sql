-- ============================================================
-- 0109 — Reset the GRN numbering sequence. GRN/26-27/0005 was
-- deleted (created blank, no lines, nothing referencing it) and the
-- next GRN raised should pick up at GRN/26-27/0001 again rather than
-- continuing from where the deleted one left off.
-- ============================================================

alter sequence public.seq_grn_no restart with 1;

-- ============================================================
-- 0110 — 0109's restart got consumed by a verification call to
-- next_grn_no() right after (nextval() always advances, even when
-- just checking what it would return) — restart once more so the
-- next GRN actually raised in the app is GRN/26-27/0001.
-- ============================================================

alter sequence public.seq_grn_no restart with 1;

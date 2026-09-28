-- ============================================================
-- 0102 — Shortfall panel: "Replace with in-stock alternative".
--
-- Adds a nullable self-pairing column to bom_lines: when a manual
-- adjustment line exists because of a substitution (one negative
-- credit against the original component, one positive demand against
-- the alternative), each row points at the *other* component involved.
-- This makes the pair idempotent to find and update — clicking the
-- button again (e.g. after stock levels shift) recomputes the same
-- pair instead of stacking duplicates.
-- ============================================================

alter table public.bom_lines add column substitution_alt_id uuid references public.components(id);
create index idx_bom_lines_substitution_alt on public.bom_lines(substitution_alt_id);

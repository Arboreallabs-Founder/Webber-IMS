-- ============================================================
-- 0106 — inventory_lots was missing piece_count and piece_length
-- entirely (only piece_weight ever got added, in 0059) even though
-- approve_irn() and the GRN dimension-patch update both write to them,
-- and the Inventory detail page selects them. Every one of those
-- silently failed (an UPDATE/SELECT against a nonexistent column
-- errors, and each of those call sites discards the error), which is
-- why a freshly-received lot could show real rows in the database but
-- "No open lots" on the Inventory page. piece_width was never added
-- to inventory_lots either, despite irns having carried it since 0036.
-- ============================================================

alter table public.inventory_lots add column piece_count numeric;
alter table public.inventory_lots add column piece_length numeric;
alter table public.inventory_lots add column piece_width numeric;

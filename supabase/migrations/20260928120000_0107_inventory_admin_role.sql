-- ============================================================
-- 0107 — New role: inventory_admin. A scoped operator who can run
-- Components master + Inventory + GRN + Requisitions end-to-end,
-- without the full master-data write access admin/team_lead have
-- (vendors, customers, categories, products, BOM templates/builder,
-- inspection templates, approval rights all stay out of reach).
--
-- Split into its own migration: Postgres won't let a new enum value
-- be referenced by other statements in the same transaction it was
-- added in, so the RLS policy updates that use 'inventory_admin' live
-- in the next migration (0108).
-- ============================================================

alter type public.role add value 'inventory_admin';

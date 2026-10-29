-- ============================================================
-- 0114 — Drop the two stale submit_irn overloads.
--
-- 0100 and 0104 each added parameters to submit_irn (p_mpn_id, then
-- p_location) with CREATE OR REPLACE, which in Postgres creates a new
-- overload instead of replacing the old one when the argument list differs.
-- The Webber database ended up with three submit_irn functions; the app
-- only ever calls the newest (with p_mpn_id and p_location).
--
-- This runs before the YAHA migration 0100_inventory_floor_grants, which
-- patches submit_irn's role allowlist and needs exactly one submit_irn.
-- ============================================================

drop function if exists public.submit_irn(
  uuid, uuid, numeric, numeric, uuid, uuid, numeric, numeric, numeric, jsonb, uuid, uuid, numeric, uuid, uuid);
drop function if exists public.submit_irn(
  uuid, uuid, numeric, numeric, uuid, uuid, numeric, numeric, numeric, jsonb, uuid, uuid, numeric, uuid, uuid, uuid);

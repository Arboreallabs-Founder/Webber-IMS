-- ============================================================
-- 0017 — Component quantity_type (nos/length/area)
-- This column/type existed on the live database ahead of 0018 but had
-- no corresponding migration file, so a fresh `db push` fails when 0018
-- builds a view against it. 'weight' is added later by 0058, matching
-- the original timeline.
-- ============================================================

create type public.quantity_type as enum ('nos', 'length', 'area');

alter table public.components
  add column quantity_type public.quantity_type not null default 'nos';

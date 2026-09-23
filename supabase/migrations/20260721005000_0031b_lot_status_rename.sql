-- ============================================================
-- 0031b — Rename lot_status enum values to the vocabulary used from
-- 0032 onward ('available' -> 'open', 'reserved' -> 'issued'). This
-- rename happened on the live database ahead of 0032's first use of
-- 'open'/'issued' but was never captured as its own migration, so a
-- fresh `db push` fails without it.
-- ============================================================

alter type public.lot_status rename value 'available' to 'open';
alter type public.lot_status rename value 'reserved'  to 'issued';

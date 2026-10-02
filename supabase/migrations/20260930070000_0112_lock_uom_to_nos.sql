-- ============================================================
-- 0112 — Same gap as 0111, one field over: the Components master form
-- forces uom: "Nos" via hiddenValues on every save, but that only ever
-- applied to the 2 components someone has actually opened and saved
-- since the bulk import — the other 523 were left with uom = null.
-- Every component is counted in Nos (quantity_type is already 'nos'
-- for all 525) so backfill the nulls and lock it down the same way:
-- a CHECK constraint so nothing can ever write anything else again.
-- ============================================================

update public.components set uom = 'Nos' where uom is distinct from 'Nos';

alter table public.components
  add constraint chk_components_uom_nos check (uom = 'Nos');

-- ============================================================
-- 0098 — WPC (component_no) is no longer unique; MPN is instead.
--
-- The same WPC can be fulfilled by more than one manufacturer part
-- (e.g. sourced from a different maker when the usual one is out of
-- stock), each with its own MPN — so multiple `components` rows can
-- now share a WPC. What must stay unique is the MPN itself: the same
-- manufacturer part number should never be entered twice as a
-- separate component record.
-- ============================================================
alter table public.components drop constraint if exists components_component_no_key;
alter table public.components add constraint components_mpn_key unique (mpn);

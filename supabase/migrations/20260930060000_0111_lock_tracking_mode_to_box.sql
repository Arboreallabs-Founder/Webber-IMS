-- ============================================================
-- 0111 — Lock every component to tracking_mode = 'box', permanently.
--
-- Root cause of the 111ER incident: a component's lot only gets a
-- `container_no` stamped on it at creation time when tracking_mode was
-- 'box' at that moment (grn_line_after_insert(), branch (c)); the
-- "add to existing box" picker on the GRN page requires
-- `container_no is not null`. 523 of the 524 components brought in by
-- the initial bulk inventory import were defaulted to tracking_mode =
-- 'bulk' (a blanket import default, not a per-part decision), so any
-- receipt against them can only ever create a new lot — there was
-- never a way to "add to an existing box" for those components,
-- regardless of anything the receiver did.
--
-- The Components master form already forces tracking_mode: "box" via
-- hiddenValues on every save (masters/components/page.tsx), but that
-- only takes effect when a component happens to get opened and saved
-- — it does nothing for the 523 components nobody has touched yet, and
-- nothing stops some other code path (a script, a future feature) from
-- writing a different value. This backfills every component to 'box'
-- and adds a CHECK constraint so nothing can ever set anything else
-- again, at the database level, regardless of application code.
-- ============================================================

update public.components set tracking_mode = 'box' where tracking_mode <> 'box';

alter table public.components
  add constraint chk_components_tracking_mode_box check (tracking_mode = 'box');

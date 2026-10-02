// Assembles supabase/rollback/0114_rollback.sql from the exact migration
// files 0114 replaced, so the rollback restores them byte-for-byte.
//   node supabase/tests/0114_reserved_slices/build-rollback.mjs .
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const repo = process.argv[2];
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, "utf8").replace(/\r\n/g, "\n");

const v0079 = mig("20260827090000_0079_component_on_hand_include_consumed.sql");
const v0069 = mig("20260818060000_0069_reverse_consumption.sql").split("drop policy if exists mov_ins")[0].trimEnd();
const v0084 = mig("20260901070000_0084_reconciliation_nets_off_stock.sql");
const f0068 = mig("20260815100000_0068_fix_requisition_split_ledger.sql");
const f0105 = mig("20260928100000_0105_lot_mpn_breakdown.sql");
const grnFn = f0105.slice(f0105.indexOf("create or replace function public.grn_line_after_insert()"));
if (!grnFn.startsWith("create or replace function")) throw new Error("grn_line_after_insert not found in 0105");

const out = `-- ============================================================
-- ROLLBACK for 0114_reserved_slices_and_auto_release.
-- NOT a migration — do not move this into supabase/migrations/.
-- Run it by hand (Supabase SQL editor) only if 0114 must be undone.
--
-- Restores, byte-for-byte from the migration files 0114 replaced:
--   v_component_on_hand (0079), v_project_consumption (0069),
--   v_bom_variance + v_missing_po (0084), issue_requisition (0068),
--   grn_line_after_insert (0105)
-- and drops the functions 0114 added.
--
-- DATA IS KEPT. Reserved parts ("slices") created while 0114 was live stay
-- as separate reserved lots, exactly like blocks made before 0114 — i.e.
-- the old problem comes back for them: they can't be found by scanning the
-- box. Before running this, consider unissuing them (Inventory → component
-- → Unissue) so their stock goes back into their boxes while that still
-- works. To list them:
--   select l.lot_code, b.lot_code as box, l.qty_on_hand, p.project_no
--     from inventory_lots l
--     join inventory_lots b on b.id = l.source_lot_id
--     left join projects p on p.id = l.project_id
--    where l.status = 'issued' and l.qty_on_hand > 0;
--
-- The source_lot_id column is left in place (nothing old reads it, and it
-- keeps the slice -> box link if 0114 is re-applied). Drop it at the very
-- end only if you're sure: alter table public.inventory_lots drop column source_lot_id;
-- ============================================================

begin;

-- ---- functions added by 0114 ----
drop function if exists public.consume_from_lot(uuid, numeric, uuid, uuid, text);
drop function if exists public.release_blocked_lot(uuid, numeric);
drop function if exists public.recheck_project_reservations(uuid);

-- ---- issue_requisition, as of 0068 ----
${f0068}

-- 0068's issue_requisition needs no helpers, so the internal ones can go now.
drop function if exists public._auto_release(uuid, uuid, uuid);
drop function if exists public._release_lot(uuid, numeric, uuid);
drop function if exists public._make_slice(uuid, numeric, public.lot_status, uuid, uuid, text, uuid);
drop function if exists public._move_mpn(uuid, uuid, numeric, uuid);

-- ---- grn_line_after_insert, as of 0105 ----
${grnFn}

-- ---- views, as of 0079 / 0069 / 0084 ----
${v0079}

${v0069}

${v0084}

commit;
`;

mkdirSync(`${repo}/supabase/rollback`, { recursive: true });
writeFileSync(`${repo}/supabase/rollback/0114_rollback.sql`, out);
console.log("wrote supabase/rollback/0114_rollback.sql", out.split("\n").length, "lines");

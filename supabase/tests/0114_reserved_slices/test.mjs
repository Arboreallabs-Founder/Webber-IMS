// Automated test for migration 0114 (reserved slices) and its rollback.
// Runs real Postgres (PGlite, in-process WebAssembly) against a stub of the
// tables 0114 touches — no database connection, nothing touches Supabase.
//
//   npm i --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/0114_reserved_slices/test.mjs .
//
// Exit code 0 = everything passed.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const repo = process.argv[2];
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, "utf8");
const db = new PGlite();

// ---- Stub of the slice of the real schema this migration touches ----
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create type public.role as enum ('admin','founder','team_lead','team_member','inventory_admin');
create type public.lot_status as enum ('open','issued','consumed');
create type public.movement_type as enum ('receipt','issue','adjustment','transfer','return');
create type public.jw_stage as enum ('raw','completed');
create type public.tracking_mode as enum ('item','box','bulk');
create type public.po_line_approval_status as enum ('pending_approval','approved','rejected');
create type public.po_line_status as enum ('pending','partial','received','cancelled');
create type public.po_status as enum ('draft','sent','partial','completed','cancelled','superseded','pending_signature');
create type public.bom_status as enum ('draft','approved');
create type public.req_status as enum ('open','partially_ordered','ordered','closed','issued','partially_issued');

create table public.profiles (id uuid primary key, role public.role);
create function public.auth_role() returns public.role language sql stable security definer set search_path = public
  as $$ select role from public.profiles where id = auth.uid() $$;

create table public.components (id uuid primary key default gen_random_uuid(), component_no text, name text, uom text,
  is_job_work boolean default false, tracking_mode public.tracking_mode default 'box', is_serialized boolean default false);
create table public.projects (id uuid primary key default gen_random_uuid(), project_no text);
create table public.grns (id uuid primary key default gen_random_uuid(), vendor_id uuid);
create table public.component_mpns (id uuid primary key default gen_random_uuid(), component_id uuid, mpn text);
create table public.purchase_orders (id uuid primary key default gen_random_uuid(), status public.po_status default 'sent');
create table public.po_lines (id uuid primary key default gen_random_uuid(), po_id uuid references public.purchase_orders(id),
  project_id uuid, component_id uuid, qty_ordered numeric, rate numeric,
  approval_status public.po_line_approval_status default 'approved', line_status public.po_line_status default 'pending');
create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(), lot_code text unique not null, component_id uuid, grn_line_id uuid,
  vendor_id uuid, project_id uuid, parent_lot_id uuid, container_no text,
  qty_on_hand numeric not null default 0, qty_initial numeric not null default 0, unit_cost numeric,
  location text, is_serialized boolean not null default false, status public.lot_status not null default 'open',
  jw_stage public.jw_stage, piece_count numeric, piece_length numeric, piece_weight numeric, piece_width numeric,
  created_at timestamptz not null default clock_timestamp(), created_by uuid, updated_at timestamptz);
create table public.grn_lines (id uuid primary key default gen_random_uuid(), grn_id uuid, component_id uuid, project_id uuid,
  qty_received numeric, unit_cost numeric, po_line_id uuid, target_lot_id uuid references public.inventory_lots(id),
  jw_line_id uuid, mpn_id uuid, location text, is_untagged boolean, created_by uuid);
create table public.inventory_lot_mpns (id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.inventory_lots(id) on delete cascade, mpn_id uuid not null references public.component_mpns(id),
  qty numeric not null default 0, created_at timestamptz not null default clock_timestamp(), created_by uuid, unique (lot_id, mpn_id));
create table public.stock_movements (id uuid primary key default gen_random_uuid(), lot_id uuid references public.inventory_lots(id),
  component_id uuid, movement_type public.movement_type, qty numeric, project_id uuid, reference_type text, reference_id uuid,
  note text, performed_by uuid, performed_at timestamptz not null default now(), created_by uuid);
create table public.boms (id uuid primary key default gen_random_uuid(), project_id uuid, status public.bom_status default 'draft');
create table public.bom_lines (id uuid primary key default gen_random_uuid(), bom_id uuid, component_id uuid, required_qty numeric);
create table public.requisitions (id uuid primary key default gen_random_uuid(), project_id uuid, status public.req_status default 'open');
create table public.requisition_lines (id uuid primary key default gen_random_uuid(), requisition_id uuid, component_id uuid, qty numeric);
create table public.job_work_lines (id uuid primary key default gen_random_uuid(), jw_order_id uuid, raw_lot_id uuid, qty_sent numeric, qty_returned numeric, completed_lot_id uuid);
create table public.job_work_orders (id uuid primary key default gen_random_uuid(), status text);
`);

// The live on-hand trigger (0097) + the GRN trigger wiring (0008), then the
// live views 0114 replaces (so CREATE OR REPLACE is tested against them).
await db.exec(mig("20260924090000_0097_fix_recompute_lot_on_hand_stale_enum_label.sql"));
await db.exec(`
create trigger trg_movement_recompute after insert or update or delete on public.stock_movements
  for each row execute function public.recompute_lot_on_hand();
create function public.grn_line_after_insert() returns trigger language plpgsql as $$ begin return NEW; end $$;
create trigger trg_grn_line_after after insert on public.grn_lines for each row execute function public.grn_line_after_insert();
`);
await db.exec(mig("20260827090000_0079_component_on_hand_include_consumed.sql"));
await db.exec(mig("20260818060000_0069_reverse_consumption.sql").split("drop policy")[0]);
await db.exec(mig("20260901070000_0084_reconciliation_nets_off_stock.sql"));

// ---- The migration under test, exactly as written ----
await db.exec(mig("20261002070000_0114_reserved_slices_and_auto_release.sql"));
console.log("migration 0114 applied OK\n");

// ---- helpers ----
let failures = 0;
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };
const as = async (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const expectError = async (fn, re, msg) => {
  try { await fn(); ok(false, `${msg} (no error)`); }
  catch (e) { ok(re.test(e.message), `${msg} -> "${e.message}"`); }
};
const lot = (id) => one(`select * from inventory_lots where id = $1`, [id]);
const mpns = async (id) => (await db.query(`select m.mpn, l.qty::float from inventory_lot_mpns l join component_mpns m on m.id = l.mpn_id where l.lot_id = $1 order by m.mpn`, [id])).rows;
const slicesOf = async (box) => (await db.query(`select * from inventory_lots where source_lot_id = $1 order by created_at`, [box])).rows;
const consume = (lotId, qty, project, req = null, note = null) =>
  one(`select public.consume_from_lot($1, $2, $3, $4, $5) as r`, [lotId, qty, project, req, note]).then((x) => x.r);

const ADMIN = "00000000-0000-0000-0000-00000000000a", MEMBER = "00000000-0000-0000-0000-00000000000b";
await db.exec(`insert into profiles values ('${ADMIN}', 'admin'), ('${MEMBER}', 'team_member')`);
const C  = (await one(`insert into components (component_no, name) values ('C-1', 'Bolt') returning id`)).id;
const JW = (await one(`insert into components (component_no, name, is_job_work) values ('JW-1', 'Shaft', true) returning id`)).id;
const P1 = (await one(`insert into projects (project_no) values ('P1') returning id`)).id;
const P2 = (await one(`insert into projects (project_no) values ('P2') returning id`)).id;
const P3 = (await one(`insert into projects (project_no) values ('P3') returning id`)).id;
const MA = (await one(`insert into component_mpns (component_id, mpn) values ($1, 'MPN-A') returning id`, [C])).id;
const MB = (await one(`insert into component_mpns (component_id, mpn) values ($1, 'MPN-B') returning id`, [C])).id;
const grn = (await one(`insert into grns default values returning id`)).id;
const po = (await one(`insert into purchase_orders default values returning id`)).id;
const pl = (await one(`insert into po_lines (po_id, component_id, qty_ordered, rate) values ($1, $2, 1000, 7) returning id`, [po, C])).id;

// Box A via GRN: 60 of MPN-A, then topped up with 40 of MPN-B (box path (c) then (a)).
const recv = (qty, mpn, project = null, target = null, comp = C) =>
  db.query(`insert into grn_lines (grn_id, component_id, project_id, qty_received, unit_cost, po_line_id, target_lot_id, mpn_id, created_by)
            values ($1, $2, $3, $4, 5, $5, $6, $7, $8) returning id`, [grn, comp, project, qty, pl, target, mpn, ADMIN]).then((r) => r.rows[0].id);
await recv(60, MA);
const BOX = (await one(`select id from inventory_lots where component_id = $1 order by created_at limit 1`, [C])).id;
await recv(40, MB, null, BOX);
ok(Number((await lot(BOX)).qty_on_hand) === 100, "box A holds 100 after GRN + top-up");
const initialBefore = Number((await lot(BOX)).qty_initial);

// ---- 1. Partial block becomes a slice linked to the box ----
const req1 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P1])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 10)`, [req1, C]);
await db.query(`select public.issue_requisition($1, $2)`, [req1, ADMIN]);
let sl = await slicesOf(BOX);
ok(sl.length === 1 && Number(sl[0].qty_on_hand) === 10 && sl[0].status === "issued" && sl[0].project_id === P1, "P1 block: 10 sliced into box A, reserved for P1");
ok(Number((await lot(BOX)).qty_on_hand) === 90, "box A open part is 90");
ok(Number((await lot(BOX)).qty_initial) === initialBefore, `box A Initial unchanged by the block (${initialBefore}; used to be reduced)`);
ok(JSON.stringify(await mpns(sl[0].id)) === JSON.stringify([{ mpn: "MPN-B", qty: 10 }]), "slice took its 10 from the newest MPN (MPN-B, LIFO)");
ok((await one(`select status from requisitions where id = $1`, [req1])).status === "issued", "requisition marked issued (needs 0113)");
const SL1 = sl[0].id;

const req2 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P2])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 5)`, [req2, C]);
await db.query(`select public.issue_requisition($1, $2)`, [req2, ADMIN]);
const SL2 = (await slicesOf(BOX)).find((s) => s.project_id === P2).id;
ok(Number((await lot(BOX)).qty_on_hand) === 85, "P2 block: 5 more sliced; box A open part is 85");

// ---- 2. Scan the BOX sticker and consume ----
await db.query(`insert into boms (project_id, status) values ($1, 'approved')`, [P1]);
await db.query(`insert into bom_lines (bom_id, component_id, required_qty) select id, $2, 10 from boms where project_id = $1`, [P1, C]);
await as(MEMBER);
let r = await consume(BOX, 4, P1, req1);
ok(r.from_reserved === 4 && r.from_open === 0, `team member scans box for P1, consumes 4: all from P1's reservation (${JSON.stringify(r)})`);
ok(Number((await lot(SL1)).qty_on_hand) === 6 && Number((await lot(BOX)).qty_on_hand) === 85, "P1 slice 10 -> 6; box open part untouched at 85");
r = await consume(BOX, 9, P1, req1);
ok(r.from_reserved === 6 && r.from_open === 3, `consume 9 more: 6 reserved + 3 open (${JSON.stringify(r)})`);
ok(Number((await lot(BOX)).qty_on_hand) === 82 && (await lot(SL1)).status === "consumed", "box open 82; P1 slice drained (kept, consumed)");
ok(Number((await lot(SL2)).qty_on_hand) === 5, "P2's reservation in the same box untouched");
await expectError(() => consume(BOX, 1000, P1, req1), /Only 82 available/, "asking for more than the box has is refused");
await expectError(() => consume(BOX, 1, null, null, "R&D"), /Only Admin/, "team member can't consume without a project");
await as(ADMIN);
await expectError(() => consume(BOX, 1, null, null, ""), /reason/, "admin stock consumption needs a reason");
r = await consume(BOX, 2, null, null, "sample");
ok(r.from_open === 2 && Number((await lot(SL2)).qty_on_hand) === 5, "admin stock consumption only touches open stock, never P2's reservation");

// ---- 3. Auto-release: project drew from a DIFFERENT box ----
await recv(50, MA);  // box B
const BOX_B = (await one(`select id from inventory_lots where component_id = $1 and source_lot_id is null and id <> $2 order by created_at desc limit 1`, [C, BOX])).id;
await db.query(`insert into boms (project_id, status) values ($1, 'approved')`, [P3]);
await db.query(`insert into bom_lines (bom_id, component_id, required_qty) select id, $2, 10 from boms where project_id = $1`, [P3, C]);
const req3 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P3])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 10)`, [req3, C]);
await db.query(`select public.issue_requisition($1, $2)`, [req3, ADMIN]);
const SL3 = (await slicesOf(BOX)).find((s) => s.project_id === P3);
ok(SL3 && Number(SL3.qty_on_hand) === 10, "P3 blocks 10 (sliced from box A, the oldest box)");
const boxABefore = Number((await lot(BOX)).qty_on_hand);
r = await consume(BOX_B, 10, P3, req3);
ok(r.from_open === 10 && r.released === 10, `P3 consumes its 10 from box B instead -> 10 auto-released (${JSON.stringify(r)})`);
ok(Number((await lot(BOX)).qty_on_hand) === boxABefore + 10, "...and the 10 went back into box A, where it physically is");
ok(!(await lot(SL3.id)), "...and the emptied, never-used P3 slice was deleted");

// ---- 4. Need = bigger of BOM and PO ----
await db.query(`insert into po_lines (po_id, project_id, component_id, qty_ordered, rate) values ($1, $2, $3, 15, 7)`, [po, P3, C]);
const req4 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P3])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 5)`, [req4, C]);
await db.query(`select public.issue_requisition($1, $2)`, [req4, ADMIN]);
r = await one(`select public.recheck_project_reservations($1) as r`, [P3]).then((x) => x.r);
ok(r.released === 0, `P3: BOM 10, PO 15, consumed 10 -> the 5 reserved stays (PO spares protected) (${JSON.stringify(r)})`);
await db.query(`update po_lines set line_status = 'cancelled' where project_id = $1`, [P3]);
r = await one(`select public.recheck_project_reservations($1) as r`, [P3]).then((x) => x.r);
ok(r.released === 5, `PO cancelled -> need back to BOM 10, all consumed -> 5 freed on recheck (${JSON.stringify(r)})`);

// No BOM and no PO -> never auto-freed.
const P4 = (await one(`insert into projects (project_no) values ('P4') returning id`)).id;
const req5 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P4])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 3)`, [req5, C]);
await db.query(`select public.issue_requisition($1, $2)`, [req5, ADMIN]);
r = await one(`select public.recheck_project_reservations($1) as r`, [P4]).then((x) => x.r);
ok(r.released === 0, "P4 has no BOM and no PO -> its reservation is left alone");

// ---- 5. Manual Unissue, partial ----
await as(MEMBER);
await expectError(() => one(`select public.release_blocked_lot($1, 2)`, [SL2]), /Only Admin/, "team member can't unissue");
await as(ADMIN);
const before = Number((await lot(BOX)).qty_on_hand);
r = await one(`select public.release_blocked_lot($1, 2) as r`, [SL2]).then((x) => x.r);
ok(r.released === 2 && Number((await lot(SL2)).qty_on_hand) === 3 && Number((await lot(BOX)).qty_on_hand) === before + 2,
  "partial unissue of P2's slice: 2 back into box A, 3 still reserved");

// ---- 6. Whole reserved lot (project GRN) partially unissued ----
await recv(20, MA, P1);
const GL = (await one(`select id from inventory_lots where project_id = $1 and source_lot_id is null and grn_line_id is not null`, [P1])).id;
ok((await lot(GL)).status === "issued", "project-tagged GRN into a new box = whole lot reserved for P1");
r = await one(`select public.release_blocked_lot($1, 5) as r`, [GL]).then((x) => x.r);
const glSlices = await slicesOf(GL);
ok((await lot(GL)).status === "open" && Number((await lot(GL)).qty_on_hand) === 5 && glSlices.length === 1
   && Number(glSlices[0].qty_on_hand) === 15 && glSlices[0].project_id === P1,
  "unissue 5 of it: the sticker lot goes open (5) and the 15 still reserved becomes a slice inside it");

// ---- 7. Project-tagged GRN into an existing box ----
const sBefore = (await slicesOf(BOX_B)).length;
await recv(8, MB, P2, BOX_B);
const gs = (await slicesOf(BOX_B)).filter((s) => s.grn_line_id);
ok(gs.length === 1 && gs[0].project_id === P2 && gs[0].status === "issued" && Number(gs[0].qty_on_hand) === 8,
  "project GRN into box B: lands as a reserved slice for P2 inside box B (was: lost into open stock)");
ok(JSON.stringify(await mpns(gs[0].id)) === JSON.stringify([{ mpn: "MPN-B", qty: 8 }]), "...with its MPN on the slice");

// ---- 8. Other project's reservation is never consumable ----
await as(MEMBER);
const req6 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P1])).id;
const reserveOnly = (await one(`select qty_on_hand from inventory_lots where id = $1`, [BOX_B])).qty_on_hand;
await expectError(() => consume(BOX_B, Number(reserveOnly) + 1, P1, req6), /Only/, "P1 can't reach P2's slice inside box B");

// ---- 9. Raw job-work box can't be consumed or blocked ----
await recv(10, null, null, null, JW);
const RAW = (await one(`select id, jw_stage from inventory_lots where component_id = $1`, [JW]));
ok(RAW.jw_stage === "raw", "job-work receipt is raw");
await expectError(() => consume(RAW.id, 1, P1, req6), /raw job-work/, "raw job-work box can't be consumed");
await as(ADMIN);
const req7 = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P1])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 4)`, [req7, JW]);
await db.query(`select public.issue_requisition($1, $2)`, [req7, ADMIN]);
ok((await lot(RAW.id)).status === "open" && (await slicesOf(RAW.id)).length === 0, "issue_requisition skips raw job-work stock");

// ---- 10. Views ----
const v = await one(`select qty_on_hand::float, stock_value::float from v_component_on_hand where component_id = $1`, [C]);
const total = await one(`select sum(qty_on_hand)::float as q from inventory_lots where component_id = $1`, [C]);
ok(v.qty_on_hand === total.q, `v_component_on_hand qty matches the lots (${v.qty_on_hand})`);
ok(Math.abs(v.stock_value - v.qty_on_hand * 7) < 1e-6, "every slice valued at its box's PO rate (7), not unit cost (5)");
const pc = await one(`select consumed_qty::float, consumption_value::float from v_project_consumption where project_id = $1 and component_id = $2`, [P1, C]);
ok(pc.consumed_qty === 13 && pc.consumption_value === 91, `P1 consumption 13 @ PO rate 7 = 91 (${JSON.stringify(pc)})`);
const bv = await one(`select received_qty::float from v_bom_variance where project_id = $1 and component_id = $2`, [P1, C]);
ok(bv.received_qty === 30, `P1 received = 20 (own GRN) + 10 (block slice), the 15 carved from its own GRN not double counted (${bv.received_qty})`);

// ---- 11. Grants ----
const g = await one(`select has_function_privilege('authenticated', 'public._release_lot(uuid, numeric, uuid)', 'execute') as internal,
                            has_function_privilege('authenticated', 'public.consume_from_lot(uuid, numeric, uuid, uuid, text)', 'execute') as rpc,
                            has_function_privilege('anon', 'public.consume_from_lot(uuid, numeric, uuid, uuid, text)', 'execute') as anon`);
ok(!g.internal && g.rpc && !g.anon, "internal helpers not callable by users; RPCs callable by signed-in users only");

// ---- 12. Ledger integrity: every lot's qty_on_hand == sum of its movements ----
const bad = await one(`select count(*)::int as n from inventory_lots l
  where l.qty_on_hand <> coalesce((select sum(qty) from stock_movements m where m.lot_id = l.id), 0)`);
ok(bad.n === 0, "every lot's on-hand still equals its ledger");
const neg = await one(`select count(*)::int as n from inventory_lots where qty_on_hand < 0`);
ok(neg.n === 0, "no lot went negative");

// ---- 12b. Helper queries shipped for manual testing ----
const here = new URL(".", import.meta.url);
const boxCode = (await lot(BOX)).lot_code;
const inspect = (await db.query(readFileSync(new URL("inspect-box.sql", here), "utf8").replace("LOT-PASTE-HERE", boxCode))).rows;
ok(inspect[0].kind === "BOX" && inspect.length === 1 + (await slicesOf(BOX)).length, `inspect-box.sql lists box A + its ${inspect.length - 1} reserved parts`);
await db.query(readFileSync(new URL("preview.sql", here), "utf8"));
ok(true, "preview.sql runs");

// ---- 13. Rollback, on top of all the data above ----
console.log("\n-- rollback --");
await db.exec(readFileSync(`${repo}/supabase/rollback/0114_rollback.sql`, "utf8"));
const fns = await one(`select count(*)::int as n from pg_proc where proname in
  ('consume_from_lot','release_blocked_lot','recheck_project_reservations','_make_slice','_release_lot','_auto_release','_move_mpn')`);
ok(fns.n === 0, "rollback removed all 7 functions 0114 added");
await recv(30, MA);  // a fresh box, via the restored 0105 GRN trigger
const OLDBOX = (await one(`select id from inventory_lots where component_id = $1 and source_lot_id is null order by created_at desc limit 1`, [C])).id;
ok(Number((await lot(OLDBOX)).qty_on_hand) === 30, "restored GRN trigger still receives stock");
const reqR = (await one(`insert into requisitions (project_id) values ($1) returning id`, [P2])).id;
await db.query(`insert into requisition_lines (requisition_id, component_id, qty) values ($1, $2, 1000)`, [reqR, C]);
const rr = (await one(`select public.issue_requisition($1, $2) as r`, [reqR, ADMIN])).r;
ok(rr.ok === true, "restored (0068) issue_requisition runs");
ok(Number((await lot(OLDBOX)).qty_initial) === 30 && (await lot(OLDBOX)).status === "issued", "...with the old behaviour (whole box taken)");
await one(`select count(*) from v_component_on_hand`); await one(`select count(*) from v_project_consumption`);
await one(`select count(*) from v_bom_variance`); await one(`select count(*) from v_missing_po`);
ok(true, "all 4 restored views query fine");
const bad2 = await one(`select count(*)::int as n from inventory_lots l
  where l.qty_on_hand <> coalesce((select sum(qty) from stock_movements m where m.lot_id = l.id), 0)`);
ok(bad2.n === 0, "ledger still consistent after rollback");

// ---- 14. Re-apply 0114 after a rollback ----
await db.exec(mig("20261002070000_0114_reserved_slices_and_auto_release.sql"));
ok(true, "0114 re-applies cleanly after a rollback");

console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILED"}`);
process.exit(failures ? 1 : 0);

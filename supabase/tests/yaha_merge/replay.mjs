// Replays every migration on an in-process Postgres (PGlite) in the order the
// Webber database gets them: first the migrations already applied on Webber
// (supabase_migrations list, captured in applied.txt), then everything else
// in timestamp order — the YAHA migrations merged in and Webber's own fix-ups.
// Nothing touches Supabase.
//
//   npm i --no-save @electric-sql/pglite@0.5.8
//   node supabase/tests/yaha_merge/replay.mjs .            # replay + smoke test
//   node supabase/tests/yaha_merge/replay.mjs . --only-applied
//   node supabase/tests/yaha_merge/replay.mjs . --fresh     # new database, timestamp order
//
// Exit code 0 = every migration applied and the smoke test passed.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const repo = process.argv[2] ?? ".";
const onlyApplied = process.argv.includes("--only-applied");
const dir = `${repo}/supabase/migrations`;
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const applied = new Set(
  readFileSync(new URL("./applied.txt", import.meta.url), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
);
const version = (f) => f.split("_")[0];
// --fresh: a brand-new database, every file in plain timestamp order.
const fresh = process.argv.includes("--fresh");
const order = fresh ? files : [
  ...files.filter((f) => applied.has(version(f))),
  ...(onlyApplied ? [] : files.filter((f) => !applied.has(version(f)))),
];

const db = new PGlite();

// ---- Supabase platform stubs the migrations rely on ----
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
create schema net;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb, timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create function vault.create_secret(secret text, name text default null, description text default null) returns uuid
  language sql as $$ insert into vault.decrypted_secrets values (name, secret); select gen_random_uuid() $$;
`);

let ok = 0;
for (const f of order) {
  // PGlite has no extensions to install; gen_random_uuid() is built in.
  const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/create extension[^;]*;/gi, "");
  try {
    // One transaction per file, like `supabase db push`.
    await db.exec(`begin;\n${sql}\n;commit;`);
    ok++;
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    console.error(`\nFAILED at ${f} (${ok} applied before it)\n  ${e.message}`);
    process.exit(1);
  }
}
console.log(`applied ${ok}/${order.length} migrations`);
if (onlyApplied) process.exit(0);

// ---- smoke test: receive into a new box with an MPN + location, top it up
// with a second MPN, then block part of it for a project and consume it ----
const q = async (s, p) => (await db.query(s, p)).rows;
const [{ id: admin }] = await q(`insert into auth.users(email) values ('a@x') returning id`);
await db.exec(`insert into public.profiles(id, full_name, role) values ('${admin}', 'Admin', 'admin') on conflict (id) do update set role = 'admin'`);
await db.exec(`select set_config('test.uid', '${admin}', false)`);

const [{ id: comp }] = await q(`insert into public.components(component_no, name) values ('119ER', 'RES 47K') returning id`);
const [{ id: mpnA }] = await q(`insert into public.component_mpns(component_id, mpn) values ($1, 'MPN-A') returning id`, [comp]);
const [{ id: mpnB }] = await q(`insert into public.component_mpns(component_id, mpn) values ($1, 'MPN-B') returning id`, [comp]);
const [{ id: grn }] = await q(`insert into public.grns(grn_no, created_by) values ('GRN/TEST/1', $1) returning id`, [admin]);

// No approver configured, so the GRN is fully signed once its creator signs —
// sign it first, so lines process straight away on insert.
const [{ id: sig }] = await q(`insert into public.signatures(user_id, label, method, image_data_url) values ($1, 's', 'typed', 'data:,x') returning id`, [admin]);
const signRes = await q(`select public.sign_grn($1, $2, $3) as r`, [grn, sig, admin]);
console.log("sign_grn:", JSON.stringify(signRes[0].r));

await q(`insert into public.grn_lines(grn_id, component_id, qty_received, mpn_id, location, created_by) values ($1, $2, 100, $3, 'RACK-1', $4)`, [grn, comp, mpnA, admin]);
const [box] = await q(`select id, lot_code, container_no, location, qty_on_hand from public.inventory_lots where component_id = $1`, [comp]);
await q(`insert into public.grn_lines(grn_id, component_id, qty_received, mpn_id, target_lot_id, created_by) values ($1, $2, 30, $3, $4, $5)`, [grn, comp, mpnB, box.id, admin]);
const mpns = await q(`select cm.mpn, m.qty from public.inventory_lot_mpns m join public.component_mpns cm on cm.id = m.mpn_id where m.lot_id = $1 order by cm.mpn`, [box.id]);
const [boxAfter] = await q(`select qty_on_hand, location from public.inventory_lots where id = $1`, [box.id]);

const checks = [
  ["box created with its own QR as container", box && box.container_no === box.lot_code],
  ["box keeps the location typed at receiving", box && box.location === "RACK-1"],
  ["box holds 130 after the top-up", Number(boxAfter.qty_on_hand) === 130],
  ["MPN breakdown: MPN-A 100, MPN-B 30", mpns.length === 2 && Number(mpns[0].qty) === 100 && Number(mpns[1].qty) === 30],
];

// Block 40 of the box for a project through a requisition: YAHA's reserved
// slice sits inside the box, so the box's QR still finds it, and consuming by
// scanning the box takes the reservation first.
const [blockProj] = await q(`insert into public.projects(project_no) values ('P-BLOCK') returning id`);
const [req] = await q(`insert into public.requisitions(req_no, project_id, requested_by, created_by) values ('REQ/T/1', $1, $2, $2) returning id`, [blockProj.id, admin]);
await q(`insert into public.requisition_lines(requisition_id, component_id, qty) values ($1, $2, 40)`, [req.id, comp]);
const [{ r: issued }] = await q(`select public.issue_requisition($1, $2) as r`, [req.id, admin]);
const slices = await q(`select qty_on_hand, status, source_lot_id from public.inventory_lots where source_lot_id = $1`, [box.id]);
const [boxBlocked] = await q(`select qty_on_hand from public.inventory_lots where id = $1`, [box.id]);
checks.push([`issuing the requisition reserves 40 inside the box (${JSON.stringify(issued)})`,
  slices.length === 1 && Number(slices[0].qty_on_hand) === 40 && Number(boxBlocked.qty_on_hand) === 90]);
const [{ r: consumed }] = await q(`select public.consume_from_lot($1, $2, 25, $3) as r`, [box.id, blockProj.id, req.id]);
const [sliceAfter] = await q(`select qty_on_hand from public.inventory_lots where source_lot_id = $1`, [box.id]);
checks.push([`scanning the box consumes from the reservation first (${JSON.stringify(consumed)})`,
  consumed?.ok === true && Number(sliceAfter?.qty_on_hand ?? 0) === 15]);
const [{ n: wipQty }] = await q(`select coalesce(sum(consumed_qty), 0) as n from public.v_project_consumption where project_id = $1`, [blockProj.id]);
checks.push([`project consumption (WIP) counts 25 (got ${wipQty})`, Number(wipQty) === 25]);

// MPN breakdown follows the stock (0116). The box held A 100 + B 30; blocking
// 40 takes the newest first (B 30, A 10) into the slice; the 25 consumed come
// out of the slice.
const mpnOf = async (lot) => Object.fromEntries((await q(
  `select cm.mpn, m.qty from public.inventory_lot_mpns m join public.component_mpns cm on cm.id = m.mpn_id where m.lot_id = $1 and m.qty > 0`, [lot]))
  .map((r) => [r.mpn, Number(r.qty)]));
const sum = (o) => Object.values(o).reduce((s, n) => s + n, 0);
const [slice] = await q(`select id from public.inventory_lots where source_lot_id = $1`, [box.id]);
let boxM = await mpnOf(box.id), sliceM = await mpnOf(slice.id);
checks.push([`blocking moved MPNs into the slice: box ${JSON.stringify(boxM)}, slice now ${JSON.stringify(sliceM)}`,
  boxM["MPN-A"] === 90 && !boxM["MPN-B"] && sum(sliceM) === 15]);

// Stock-take finds 10 fewer in the box.
await q(`insert into public.stock_movements(lot_id, component_id, movement_type, qty, reference_type, performed_by, created_by) values ($1, $2, 'adjustment', -10, 'stock-take', $3, $3)`, [box.id, comp, admin]);
boxM = await mpnOf(box.id);
checks.push([`stock-take shortfall comes off the box's MPNs (${JSON.stringify(boxM)})`, boxM["MPN-A"] === 80]);

// Reversing the consumption puts back exactly the MPNs it took.
const [issueMove] = await q(`select id, lot_id, qty from public.stock_movements where movement_type = 'issue' and lot_id = $1`, [slice.id]);
const before = await mpnOf(slice.id);
const taken = Object.fromEntries((await q(`select cm.mpn, m.qty from public.stock_movement_mpns m join public.component_mpns cm on cm.id = m.mpn_id where m.movement_id = $1`, [issueMove.id])).map((r) => [r.mpn, Number(r.qty)]));
await q(`insert into public.stock_movements(lot_id, component_id, movement_type, qty, project_id, reference_type, reference_id, performed_by, created_by) values ($1, $2, 'return', 25, $3, 'consumption_reversal', $4, $5, $5)`, [slice.id, comp, blockProj.id, issueMove.id, admin]);
sliceM = await mpnOf(slice.id);
checks.push([`reversal restores what the consumption took (took ${JSON.stringify(taken)}; slice ${JSON.stringify(before)} -> ${JSON.stringify(sliceM)})`,
  sum(taken) === 25 && sliceM["MPN-B"] === 30 && sliceM["MPN-A"] === 10]);

// Unissuing the slice hands its stock and MPNs back to the box.
const [{ r: unissued }] = await q(`select public.release_blocked_lot($1) as r`, [slice.id]);
boxM = await mpnOf(box.id);
const [boxNow] = await q(`select qty_on_hand from public.inventory_lots where id = $1`, [box.id]);
checks.push([`unissue moves MPNs back into the box (${JSON.stringify(unissued)}; box ${boxNow.qty_on_hand} = ${JSON.stringify(boxM)})`,
  Number(boxNow.qty_on_hand) === 120 && boxM["MPN-A"] === 90 && boxM["MPN-B"] === 30]);

// A GRN that isn't fully signed yet creates no stock and no QR (YAHA 0096).
const [{ id: grn2 }] = await q(`insert into public.grns(grn_no, created_by) values ('GRN/TEST/2', $1) returning id`, [admin]);
await q(`insert into public.grn_lines(grn_id, component_id, qty_received, mpn_id, created_by) values ($1, $2, 5, $3, $4)`, [grn2, comp, mpnA, admin]);
const pending = await q(`select 1 from public.inventory_lots l join public.grn_lines g on g.id = l.grn_line_id where g.grn_id = $1`, [grn2]);
checks.push(["unsigned GRN line creates no lot yet", pending.length === 0]);
await q(`select public.sign_grn($1, $2, $3)`, [grn2, sig, admin]);
const posted = await q(`select l.id, (select sum(qty) from public.inventory_lot_mpns m where m.lot_id = l.id) mq
  from public.inventory_lots l join public.grn_lines g on g.id = l.grn_line_id where g.grn_id = $1`, [grn2]);
checks.push(["signing it creates the lot with its MPN breakdown", posted.length === 1 && Number(posted[0].mq) === 5]);

// Valuation: a PO-less line is valued at the unit cost typed at GRN; a line
// against an approved PO line is valued at the PO rate.
const [{ id: noPoLine }] = await q(`insert into public.grn_lines(grn_id, component_id, qty_received, unit_cost, created_by) values ($1, $2, 10, 12.5, $3) returning id`, [grn, comp, admin]);
const [noPoRate] = await q(`select r.rate from public.v_lot_rates r join public.inventory_lots l on l.id = r.lot_id where l.grn_line_id = $1`, [noPoLine]);
checks.push([`no PO: lot valued at the GRN unit cost 12.5 (got ${noPoRate?.rate})`, Number(noPoRate?.rate) === 12.5]);
const [{ id: po }] = await q(`insert into public.purchase_orders(po_no, created_by) values (public.peek_next_po_no(), $1) returning id`, [admin]);
const [{ id: poLine }] = await q(`insert into public.po_lines(po_id, component_id, qty_ordered, rate) values ($1, $2, 10, 20) returning id`, [po, comp]);
await q(`update public.po_lines set approval_status = 'approved' where id = $1`, [poLine]);
const [{ id: poGrnLine }] = await q(`insert into public.grn_lines(grn_id, component_id, qty_received, po_line_id, created_by) values ($1, $2, 10, $3, $4) returning id`, [grn, comp, poLine, admin]);
const [poRate] = await q(`select r.rate from public.v_lot_rates r join public.inventory_lots l on l.id = r.lot_id where l.grn_line_id = $1`, [poGrnLine]);
checks.push([`with PO: lot valued at the PO rate 20 (got ${poRate?.rate})`, Number(poRate?.rate) === 20]);
await q(`delete from public.purchase_orders where id = $1`, [po]).catch(() => {});

// PO numbering uses the Webber prefix.
const [{ n }] = await q(`select public.peek_next_po_no() as n`);
checks.push([`next PO number is WEC/… (got ${n})`, /^WEC\/\d{2}-\d{2}\/\d{4}$/.test(n)]);

// New projects don't need a BOM in Webber.
const [{ id: cust }] = await q(`insert into public.customers(name) values ('C') returning id`).catch(() => [{ id: null }]);
const [proj] = await q(`insert into public.projects(project_no, customer_id) values ('P-1', $1) returning id, bom_policy`, [cust]);
checks.push([`new project bom_policy is legacy (got ${proj.bom_policy})`, proj.bom_policy === "legacy"]);

// Inventory Admin can still do what Webber gave the role.
const pol = await q(`select policyname, with_check from pg_policies where policyname in ('grns_ins','grnline_ins','req_ins','reqline_ins')`);
for (const p of pol) checks.push([`${p.policyname} allows inventory_admin and floor`, /inventory_admin/.test(p.with_check) && /floor/.test(p.with_check)]);
const fns = await q(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('consume_from_lot','submit_irn')`);
for (const f of fns) checks.push([`${f.proname} allows inventory_admin`, /inventory_admin/.test(f.d)]);
checks.push(["exactly one submit_irn", fns.filter((f) => f.proname === "submit_irn").length === 1]);

// Every lot that has an MPN breakdown adds up to what it holds.
const off = await q(`select l.lot_code, l.qty_on_hand, sum(m.qty) mq from public.inventory_lots l
  join public.inventory_lot_mpns m on m.lot_id = l.id group by l.id having sum(m.qty) <> l.qty_on_hand`);
checks.push([`every MPN breakdown matches its lot's stock (${off.length} off${off.length ? ": " + JSON.stringify(off) : ""})`, off.length === 0]);

let failed = 0;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
process.exit(failed ? 1 : 0);

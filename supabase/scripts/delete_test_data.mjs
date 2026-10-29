// Deletes the ZZTEST records left by the end-to-end test run, and everything
// that hangs off them, in one transaction. Without --go it only reports what
// it would delete and rolls back.
//
//   node supabase/scripts/delete_test_data.mjs          # dry run
//   node supabase/scripts/delete_test_data.mjs --go     # delete
//
// Roots: vendor/customer "ZZTEST …", components and projects "ZZTEST-…", and
// every PO / GRN raised against the ZZTEST vendor. From there it follows every
// foreign key downward (rows that point AT a deleted row are deleted too), so
// lines, lots, movements, MPN rows, signatures-on-documents, requisitions,
// dispatches and notifications all go with their parent. It never walks
// upward, so shared rows (users, signatures, real components) are untouched.
// Uses DATABASE_URL from .env.local.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const go = process.argv.includes("--go");
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;

// Real stock, before — must be identical after.
const realStock = `select count(*) lots, coalesce(sum(qty_on_hand), 0) qty from public.inventory_lots l
  join public.components c on c.id = l.component_id where c.component_no not like 'ZZTEST-%'`;
const [before] = await q(realStock);

// Single-column FKs in public: child.col -> parent.id
const fks = await q(`
  select cl.relname child, a.attname col, pl.relname parent, not a.attnotnull nullable
    from pg_constraint k
    join pg_class cl on cl.oid = k.conrelid join pg_namespace cn on cn.oid = cl.relnamespace
    join pg_class pl on pl.oid = k.confrelid join pg_namespace pn on pn.oid = pl.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
   where k.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public'
     and array_length(k.conkey, 1) = 1 and pa.attname = 'id'`);
const hasId = new Set((await q(`select table_name from information_schema.columns
  where table_schema = 'public' and column_name = 'id'`)).map((r) => r.table_name));

const ids = new Map(); // table -> Set(id)
const add = (t, list) => { const s = ids.get(t) ?? ids.set(t, new Set()).get(t); let n = 0; for (const r of list) if (!s.has(r.id)) { s.add(r.id); n++; } return n; };
add("vendors", await q(`select id from public.vendors where name = 'ZZTEST Vendor'`));
add("customers", await q(`select id from public.customers where name = 'ZZTEST Customer'`));
add("components", await q(`select id from public.components where component_no like 'ZZTEST-%'`));
add("projects", await q(`select id from public.projects where project_no like 'ZZTEST-%'`));
add("purchase_orders", await q(`select id from public.purchase_orders where vendor_id in (select id from public.vendors where name = 'ZZTEST Vendor')`));
add("grns", await q(`select id from public.grns where vendor_id in (select id from public.vendors where name = 'ZZTEST Vendor')`));

// Walk down the FK graph to a fixed point.
const noId = []; // [child, col, parent] for child tables keyed without an id column
for (let changed = true; changed;) {
  changed = false;
  for (const fk of fks) {
    const parentIds = ids.get(fk.parent);
    if (!parentIds?.size) continue;
    if (!hasId.has(fk.child)) {
      if (!noId.some((x) => x[0] === fk.child && x[1] === fk.col)) noId.push([fk.child, fk.col, fk.parent]);
      continue;
    }
    const rows = await q(`select id from public."${fk.child}" where "${fk.col}" = any($1::uuid[])`, [[...parentIds]]);
    if (add(fk.child, rows)) changed = true;
  }
}

// Rows that point at test records by id but without a foreign key: signatures
// on POs/GRNs, the activity log, notifications that link to a test page.
const allIds = [...ids.values()].flatMap((s) => [...s]);
add("document_signatures", await q(`select id from public.document_signatures where document_id = any($1::uuid[])`, [allIds]));
add("audit_log", await q(`select id from public.audit_log where row_id = any($1::uuid[])`, [allIds]));
add("notifications", await q(`select id from public.notifications where exists (
  select 1 from unnest($1::text[]) i where link_path like '%' || i || '%')`, [allIds]));
for (const fk of fks.filter((f) => f.parent === "notifications" && !hasId.has(f.child))) {
  if (!noId.some((x) => x[0] === fk.child && x[1] === fk.col)) noId.push([fk.child, fk.col, fk.parent]);
}

console.log("would delete:");
for (const [t, s] of [...ids].sort()) if (s.size) console.log(`  ${t.padEnd(28)} ${s.size}`);
for (const [t, col, p] of noId) {
  const [{ n }] = await q(`select count(*) n from public."${t}" where "${col}" = any($1::uuid[])`, [[...(ids.get(p) ?? [])]]);
  if (Number(n)) console.log(`  ${(t + " (by " + col + ")").padEnd(28)} ${n}`);
}

// Safety: the named masters in the set must all be test records.
const guard = {
  components: ["component_no", /^ZZTEST-/], projects: ["project_no", /^ZZTEST-/],
  vendors: ["name", /^ZZTEST /], customers: ["name", /^ZZTEST /],
};
for (const [t, [col, re]] of Object.entries(guard)) {
  const rows = ids.get(t)?.size ? await q(`select "${col}" v from public."${t}" where id = any($1::uuid[])`, [[...ids.get(t)]]) : [];
  const bad = rows.filter((r) => !re.test(r.v));
  if (bad.length) { console.error(`STOP: ${t} would include non-test rows: ${bad.map((r) => r.v).join(", ")}`); process.exit(1); }
}
console.log("guard: every vendor/customer/component/project in the set is a ZZTEST record");

await q("begin");
try {
  const tables = [...new Set([...ids.keys(), ...noId.map((x) => x[0])])];
  for (const t of tables) await q(`alter table public."${t}" disable trigger user`);
  // Break FK links between rows that are all being deleted (lot <-> grn line, slice -> box).
  for (const fk of fks) {
    if (!fk.nullable || !ids.get(fk.child)?.size || !ids.get(fk.parent)?.size) continue;
    await q(`update public."${fk.child}" set "${fk.col}" = null where id = any($1::uuid[]) and "${fk.col}" = any($2::uuid[])`,
      [[...ids.get(fk.child)], [...ids.get(fk.parent)]]);
  }
  for (const [t, col, p] of noId) await q(`delete from public."${t}" where "${col}" = any($1::uuid[])`, [[...(ids.get(p) ?? [])]]);
  // Delete, retrying tables a foreign key still blocks until everything is gone.
  let left = [...ids].filter(([, s]) => s.size);
  for (let pass = 0; left.length && pass < 20; pass++) {
    const next = [];
    for (const [t, s] of left) {
      await q("savepoint d");
      try { await q(`delete from public."${t}" where id = any($1::uuid[])`, [[...s]]); await q("release savepoint d"); }
      catch (e) { await q("rollback to savepoint d"); next.push([t, s, e.message]); }
    }
    left = next;
  }
  if (left.length) throw new Error("could not delete: " + left.map(([t, , m]) => `${t} (${m})`).join("; "));
  for (const t of tables) await q(`alter table public."${t}" enable trigger user`);

  const [after] = await q(realStock);
  const [leftover] = await q(`select (select count(*) from public.components where component_no like 'ZZTEST-%')
    + (select count(*) from public.projects where project_no like 'ZZTEST-%')
    + (select count(*) from public.vendors where name like 'ZZTEST%') n`);
  console.log(`real stock before ${before.lots} lots / ${before.qty}, after ${after.lots} lots / ${after.qty}; ZZTEST rows left: ${leftover.n}`);
  if (after.lots !== before.lots || after.qty !== before.qty || Number(leftover.n) !== 0) throw new Error("check failed — rolling back");

  if (go) { await q("commit"); console.log("DELETED."); }
  else { await q("rollback"); console.log("dry run — rolled back. Re-run with --go to delete."); }
} catch (e) {
  await q("rollback").catch(() => {});
  console.error("ROLLED BACK:", e.message);
  process.exitCode = 1;
}
await c.end();

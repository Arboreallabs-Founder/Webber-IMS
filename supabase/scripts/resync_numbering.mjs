// Points each document-number counter at the highest number actually in use
// this fiscal year, so the next one follows on without a gap or a clash —
// e.g. after deleting test documents. PO numbers need nothing: they are
// already computed from the highest existing PO.
//   node supabase/scripts/resync_numbering.mjs
// Uses DATABASE_URL from .env.local.
import pg from "pg";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const counters = [
  ["seq_grn_no", "grns", "grn_no", "GRN"],
  ["seq_req_no", "requisitions", "req_no", "REQ"],
  ["seq_dispatch_no", "dispatches", "dispatch_no", "DSP"],
  ["seq_fg_no", "finished_goods", "serial_no", "FG"],
];
await c.query("begin");
for (const [seq, table, col, prefix] of counters) {
  const { rows: [{ n }] } = await c.query(
    `select coalesce(max((regexp_match(${col}, '^${prefix}/' || public.fiscal_year_label() || '/([0-9]+)$'))[1]::int), 0) n from public.${table}`);
  // setval(seq, n, true): next nextval() returns n + 1; with n = 0, restart at 1.
  if (Number(n) > 0) await c.query(`select setval('public.${seq}', $1, true)`, [n]);
  else await c.query(`alter sequence public.${seq} restart with 1`);
  console.log(`${seq.padEnd(18)} highest in use ${prefix}/…/${String(n).padStart(4, "0")} → next ${String(Number(n) + 1).padStart(4, "0")}`);
}
await c.query("commit");
const { rows: [{ po }] } = await c.query(`select public.peek_next_po_no() po`);
console.log(`next PO             ${po}`);
await c.end();

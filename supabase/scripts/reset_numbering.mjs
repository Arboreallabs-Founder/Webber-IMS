// Restarts document numbering. GRN continues from 0002 because
// GRN/26-27/0001 is the opening-stock GRN. Reads DATABASE_URL from .env.local.
//   node supabase/scripts/reset_numbering.mjs
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const restart = {
  seq_grn_no: 2,
  seq_po_no: 1,
  seq_req_no: 1,
  seq_irn_no: 1,
  seq_jw_no: 1,
  seq_jw_grn_no: 1,
  seq_site_purchase_no: 1,
};

const { rows: existing } = await client.query(
  `select sequencename from pg_sequences where schemaname = 'public' and sequencename = any($1)`,
  [Object.keys(restart)],
);
const have = new Set(existing.map((r) => r.sequencename));

await client.query("begin");
for (const [seq, n] of Object.entries(restart)) {
  if (!have.has(seq)) { console.log(`skip ${seq} (doesn't exist)`); continue; }
  await client.query(`alter sequence public.${seq} restart with ${n}`);
}
await client.query("commit");

// Read back without consuming a number (nextval would use one up).
const { rows } = await client.query(
  `select sequencename, last_value from pg_sequences
    where schemaname = 'public' and sequencename = any($1) order by sequencename`,
  [Object.keys(restart)],
);
for (const r of rows) {
  // After RESTART, last_value is null until the next nextval(); the next number is the restart value.
  console.log(`${r.sequencename}: next number = ${String(r.last_value ?? restart[r.sequencename]).padStart(4, "0")}`);
}
const { rows: grns } = await client.query(`select grn_no from public.grns order by grn_no`);
console.log("existing GRNs:", grns.map((g) => g.grn_no).join(", "));
await client.end();

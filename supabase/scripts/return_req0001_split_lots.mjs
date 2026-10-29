// Puts the two lots split off by REQ/26-27/0001 (project since deleted) back
// into their source boxes, and closes the requisition. Usage: node ... [--go]
// Reverse: delete the 4 movements with reference_type='requisition_unblock'
// and set the requisition status back to 'issued'.
import pg from "pg"; import fs from "fs";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const go = process.argv.includes("--go");
const REQ = "65eb0601-b337-4ad4-8d34-3c156db3a6e8";
const ADMIN = "d79bb410-3095-44ec-b21b-444e2441149f";
const pairs = [
  { split: "b9748bac-0100-49d9-9035-1ea75e3f82c1", box: "73cf665d-0dbd-4b5f-9a6b-2d3d94982ec7", qty: 20 },
  { split: "e9f416c3-146a-4f65-95d9-7fbfe99ed060", box: "9f87d412-dbd3-4bac-8e72-7d6f5e0648b1", qty: 100 },
];
const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const show = async (label) => {
  const { rows } = await c.query(
    `select l.lot_code, l.qty_on_hand, l.status, (select sum(qty) from inventory_lot_mpns m where m.lot_id=l.id) mpn_qty
       from inventory_lots l where id = any($1) order by lot_code`, [pairs.flatMap(p => [p.split, p.box])]);
  const r = await c.query(`select req_no, status from requisitions where id=$1`, [REQ]);
  console.log(label, rows, r.rows);
};
await c.query("begin");
try {
  await show("BEFORE");
  for (const p of pairs) {
    const { rows: [l] } = await c.query(`select qty_on_hand, component_id from inventory_lots where id=$1 for update`, [p.split]);
    if (Number(l.qty_on_hand) !== p.qty) throw new Error(`split lot ${p.split} has ${l.qty_on_hand}, expected ${p.qty}`);
    for (const [lot, q] of [[p.split, -p.qty], [p.box, p.qty]]) {
      await c.query(
        `insert into stock_movements(lot_id, component_id, movement_type, qty, reference_type, reference_id, performed_by, created_by, note)
         values ($1,$2,'transfer',$3,'requisition_unblock',$4,$5,$5,'Returned to box: REQ/26-27/0001 project was deleted')`,
        [lot, l.component_id, q, REQ, ADMIN]);
    }
  }
  await c.query(`update requisitions set status='closed' where id=$1`, [REQ]);
  await show("AFTER");
  await c.query(go ? "commit" : "rollback");
  console.log(go ? "COMMITTED" : "TRIAL ONLY — rolled back");
} catch (e) { await c.query("rollback"); console.error("FAILED, rolled back:", e.message); process.exitCode = 1; }
await c.end();

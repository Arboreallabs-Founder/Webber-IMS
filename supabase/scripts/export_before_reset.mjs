// READ-ONLY safety export: saves every row reset_inventory_po_grn_req.sql
// will delete (plus their child rows) as JSON, one file per table.
//   node supabase/scripts/export_before_reset.mjs <out-dir>
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const tables = [
  "inventory_lots", "stock_movements", "inventory_lot_mpns",
  "purchase_orders", "po_lines",
  "grns", "grn_lines", "irns", "irn_answers",
  "mrins", "mrin_lines", "mrin_inspection_checks", "mrin_document_checks", "mrin_checklist_answers",
  "requisitions", "requisition_lines",
  "job_work_orders", "job_work_lines",
  "site_purchases",
  "projects", "boms", "bom_lines", "project_line_items", "project_documents", "project_activities",
  "document_signatures", "notifications", "notification_reads",
];

let total = 0;
for (const t of tables) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa.from(t).select("*").range(from, from + 999);
    if (error) { console.log(`${t}: SKIPPED (${error.message})`); rows.length = 0; break; }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows, null, 1));
  total += rows.length;
  console.log(`${t}: ${rows.length}`);
}
console.log(`\nsaved ${total} rows to ${outDir}`);

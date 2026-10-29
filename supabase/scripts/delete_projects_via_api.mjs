// Deletes ALL projects and their BOMs (bom_lines, line items, documents,
// activities go with them via ON DELETE CASCADE). Keeps BOM templates.
// Saves a JSON copy of everything first. Stops at the first error.
//   node supabase/scripts/delete_projects_via_api.mjs <backup-dir> [--go]
// Without --go it only backs up and shows counts.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";

config({ path: ".env.local" });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const [outDir, go] = [process.argv[2], process.argv.includes("--go")];
mkdirSync(outDir, { recursive: true });

const related = ["projects", "boms", "bom_lines", "project_line_items", "project_documents", "project_activities",
  "finished_goods", "notifications", "notification_reads"];
for (const t of related) {
  const { data, error } = await supa.from(t).select("*");
  if (error) { console.log(`${t}: not present (${error.message})`); continue; }
  writeFileSync(join(outDir, `${t}.json`), JSON.stringify(data, null, 1));
  console.log(`${t}: ${data.length} rows backed up`);
}

// Anything else that still points at a project would block the delete.
for (const t of ["requisitions", "po_lines", "grn_lines", "inventory_lots", "stock_movements", "job_work_orders", "site_purchases", "irns"]) {
  const { count } = await supa.from(t).select("id", { count: "exact", head: true }).not("project_id", "is", null);
  if (count) console.log(`WARNING: ${t} still has ${count} row(s) tagged to a project`);
}
if (!go) { console.log("\n(preview only — re-run with --go to delete)"); process.exit(0); }

async function step(label, q) {
  const { error, count } = await q;
  if (error) { console.error(`FAILED at "${label}": ${error.message}`); process.exit(1); }
  console.log(`ok  ${label}${count != null ? ` (${count})` : ""}`);
}
await step("notifications tagged to a project", supa.from("notifications").delete({ count: "exact" }).not("project_id", "is", null));
await step("projects (+ BOMs, BOM lines, line items, documents, activities)",
  supa.from("projects").delete({ count: "exact" }).not("id", "is", null));

console.log("\nleft:");
for (const t of ["projects", "boms", "bom_lines", "project_line_items", "bom_templates", "components"]) {
  const { count } = await supa.from(t).select("id", { count: "exact", head: true });
  console.log(`  ${t}: ${count}`);
}

// Runs PART 2 of reset_inventory_po_grn_req.sql through the service-role API
// (no DB password needed), in the same order. Stops at the first error.
// Can't restart sequences — run those lines in the SQL editor afterwards.
//   node supabase/scripts/run_reset_via_api.mjs
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function step(label, q) {
  const { error, count } = await q;
  if (error) { console.error(`FAILED at "${label}": ${error.message}`); process.exit(1); }
  console.log(`ok  ${label}${count != null ? ` (${count})` : ""}`);
}
const all = (t) => supa.from(t).delete({ count: "exact" }).not("id", "is", null);

const { data: internal, error: ie } = await supa.from("projects").select("id, project_no").eq("is_internal", true);
if (ie) { console.error(ie.message); process.exit(1); }
const internalIds = (internal ?? []).map((p) => p.id);
console.log(`internal consumptions to delete: ${internal.map((p) => p.project_no).join(", ") || "none"}\n`);

await step("site purchases", all("site_purchases"));
await step("IRNs", all("irns"));
await step("unlink GRN lines from lots/job work",
  supa.from("grn_lines").update({ target_lot_id: null, jw_line_id: null }).or("target_lot_id.not.is.null,jw_line_id.not.is.null"));
await step("job-work orders", all("job_work_orders"));
await step("stock movements", all("stock_movements"));
await step("inventory lots", all("inventory_lots"));
await step("GRNs", all("grns"));
await step("purchase orders", all("purchase_orders"));
await step("requisitions", all("requisitions"));
await step("notifications about deleted documents",
  supa.from("notifications").delete({ count: "exact" })
    .or("link_path.like./purchase-orders*,link_path.like./grn*,link_path.like./requisitions*,link_path.like./inventory*,link_path.like./job-work*,link_path.like./internal-consumption*"));
if (internalIds.length) {
  await step("notifications on internal consumptions", supa.from("notifications").delete({ count: "exact" }).in("project_id", internalIds));
  await step("internal consumptions", supa.from("projects").delete({ count: "exact" }).in("id", internalIds));
}
await step("PO/GRN/JW signatures", supa.from("document_signatures").delete({ count: "exact" }).in("document_type", ["po", "grn", "job_work"]));

console.log("\nleft:");
for (const t of ["inventory_lots", "stock_movements", "inventory_lot_mpns", "purchase_orders", "po_lines", "grns", "grn_lines", "irns", "requisitions", "requisition_lines", "job_work_orders", "site_purchases"]) {
  const { count } = await supa.from(t).select("id", { count: "exact", head: true });
  console.log(`  ${t}: ${count}`);
}
const { count: ic } = await supa.from("projects").select("id", { count: "exact", head: true }).eq("is_internal", true);
const { count: cp } = await supa.from("projects").select("id", { count: "exact", head: true }).eq("is_internal", false);
const { count: cc } = await supa.from("components").select("id", { count: "exact", head: true });
console.log(`  internal consumptions: ${ic}\n  [kept] customer projects: ${cp}\n  [kept] components: ${cc}`);

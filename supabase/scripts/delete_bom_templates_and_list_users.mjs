// 1. Backs up and deletes all BOM templates (their lines go with them).
// 2. Lists the user-related data that exists (read-only; no signature images).
//   node supabase/scripts/delete_bom_templates_and_list_users.mjs <backup-dir>
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

// ---- 1. BOM templates ----
for (const t of ["bom_templates", "bom_template_lines"]) {
  const { data, error } = await supa.from(t).select("*");
  if (error) { console.error(`backup of ${t} failed: ${error.message}`); process.exit(1); }
  writeFileSync(join(outDir, `${t}.json`), JSON.stringify(data, null, 1));
  console.log(`${t}: ${data.length} rows backed up`);
}
const { error: delErr, count } = await supa.from("bom_templates").delete({ count: "exact" }).not("id", "is", null);
if (delErr) { console.error(`delete failed: ${delErr.message}`); process.exit(1); }
for (const t of ["bom_templates", "bom_template_lines"]) {
  const { count: left } = await supa.from(t).select("id", { count: "exact", head: true });
  console.log(`deleted ${t === "bom_templates" ? count : "(cascade)"} — ${t} left: ${left}`);
}

// ---- 2. User data (read-only) ----
console.log("\n=== USERS ===");
const { data: authUsers } = await supa.auth.admin.listUsers({ perPage: 1000 });
const { data: profiles } = await supa.from("profiles").select("*");
const prof = new Map((profiles ?? []).map((p) => [p.id, p]));
for (const u of authUsers?.users ?? []) {
  const p = prof.get(u.id) ?? {};
  console.log(`- ${p.full_name ?? "(no name)"} | ${u.email} | role: ${p.role ?? "(no profile)"} | last sign-in: ${u.last_sign_in_at?.slice(0, 10) ?? "never"} | created: ${u.created_at.slice(0, 10)}`);
}
const orphan = (profiles ?? []).filter((p) => !(authUsers?.users ?? []).some((u) => u.id === p.id));
if (orphan.length) console.log(`profiles with no login account: ${orphan.length}`);
console.log(`profile columns: ${Object.keys(profiles?.[0] ?? {}).join(", ")}`);

const counts = async (t, sel = "*") => {
  const { data, error } = await supa.from(t).select(sel);
  return error ? `n/a (${error.message})` : data;
};
const sigs = await counts("signatures", "user_id, is_default, created_at");
console.log(`\nsaved signature images: ${Array.isArray(sigs) ? sigs.length : sigs}`);
if (Array.isArray(sigs)) for (const s of sigs) console.log(`  - ${prof.get(s.user_id)?.full_name ?? s.user_id}${s.is_default ? " (default)" : ""}`);
const rights = await counts("approval_rights", "document_type, approver_order, user_id");
console.log(`approval rights (who signs what): ${Array.isArray(rights) ? rights.length : rights}`);
if (Array.isArray(rights)) for (const r of rights) console.log(`  - ${r.document_type} slot ${r.approver_order}: ${prof.get(r.user_id)?.full_name ?? r.user_id ?? "(unassigned)"}`);
const push = await counts("push_subscriptions", "user_id");
console.log(`push-notification subscriptions: ${Array.isArray(push) ? push.length : push}`);
for (const t of ["document_signatures", "notifications", "notification_reads", "audit_log", "teams"]) {
  const { count: c, error } = await supa.from(t).select("*", { count: "exact", head: true });
  console.log(`${t}: ${error ? "n/a" : c}`);
}

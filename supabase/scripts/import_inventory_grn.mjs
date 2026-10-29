// Opening-stock import: receives every row of an inventory sheet into ONE
// GRN, one box lot (own QR) per row, with its MPN.
//   node supabase/scripts/import_inventory_grn.mjs "<file.xlsx>"          dry run (reads only)
//   node supabase/scripts/import_inventory_grn.mjs "<file.xlsx>" --go     do it
// Sheet columns (no header): component no | name | MPN | qty
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
config({ path: ".env.local" });
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const [file, go] = [process.argv[2], process.argv.includes("--go")];

// ---- 1. Read + validate the sheet ----
const wb = XLSX.readFile(file);
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
const rows = [];
const problems = [];
raw.forEach((r, i) => {
  const [no, name, mpn, qty] = r.map((v) => (typeof v === "string" ? v.trim() : v));
  if (!no && !name && !mpn && (qty === "" || qty == null)) return; // blank row
  const n = typeof qty === "number" ? qty : Number(String(qty).replace(/,/g, ""));
  // "-", "NA", "N/A" are placeholders for "no MPN", not a real part number.
  const realMpn = mpn && !/^(-+|n\/?a|nil|none)$/i.test(String(mpn).trim()) ? String(mpn) : null;
  if (!no) problems.push(`row ${i + 1}: no component number`);
  else if (!(n > 0)) problems.push(`row ${i + 1}: ${no} — qty "${qty}" is not a positive number`);
  else rows.push({ row: i + 1, no: String(no), name: String(name), mpn: realMpn, qty: n });
});

// ---- 2. Match components + MPNs against the live master ----
async function fetchAll(table, sel) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supa.from(table).select(sel).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
const comps = await fetchAll("components", "id, component_no, name, tracking_mode, uom");
const mpns = await fetchAll("component_mpns", "id, component_id, mpn");
const compByNo = new Map(comps.map((c) => [c.component_no.trim().toUpperCase(), c]));
const compById = new Map(comps.map((c) => [c.id, c]));
const mpnByText = new Map(mpns.map((m) => [m.mpn.trim().toUpperCase(), m]));

const newComps = new Map();   // no -> name (first seen)
const nameMismatch = [];
const newMpns = new Map();    // "NO|MPN" -> {no, mpn}
const mpnConflicts = [];
const noMpn = [];
for (const r of rows) {
  const c = compByNo.get(r.no.toUpperCase());
  if (!c) {
    if (!newComps.has(r.no)) newComps.set(r.no, r.name);
  } else if (r.name && c.name.trim().toUpperCase() !== r.name.toUpperCase()) {
    nameMismatch.push(`${r.no}: master "${c.name}" vs sheet "${r.name}"`);
  }
  if (!r.mpn) { noMpn.push(`row ${r.row}: ${r.no}`); continue; }
  const m = mpnByText.get(r.mpn.toUpperCase());
  if (m) {
    const owner = compById.get(m.component_id);
    if (!c || m.component_id !== c.id) mpnConflicts.push(`row ${r.row}: MPN ${r.mpn} is listed under ${r.no} in the sheet, but belongs to ${owner?.component_no ?? "another component"} in the master`);
  } else {
    newMpns.set(`${r.no.toUpperCase()}|${r.mpn.toUpperCase()}`, { no: r.no, mpn: r.mpn });
  }
}
// The same NEW MPN under two different components can't both be created.
const newMpnOwners = new Map();
for (const m of newMpns.values()) newMpnOwners.set(m.mpn.toUpperCase(), [...(newMpnOwners.get(m.mpn.toUpperCase()) ?? []), m.no]);
for (const [mpn, owners] of newMpnOwners) if (owners.length > 1) mpnConflicts.push(`MPN ${mpn} appears under ${owners.join(" and ")} in the sheet`);
const dupKeys = new Map();
for (const r of rows) {
  const k = `${r.no.toUpperCase()}|${(r.mpn ?? "").toUpperCase()}`;
  dupKeys.set(k, [...(dupKeys.get(k) ?? []), r.row]);
}
const dups = [...dupKeys.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k.replace("|", " / ")}: rows ${v.join(", ")}`);
const nonBox = [...new Set(rows.map((r) => compByNo.get(r.no.toUpperCase())).filter((c) => c && c.tracking_mode !== "box").map((c) => `${c.component_no} (${c.tracking_mode})`))];

console.log(`sheet rows: ${raw.length}, usable lines: ${rows.length}, total qty: ${rows.reduce((s, r) => s + r.qty, 0)}`);
console.log(`distinct components: ${new Set(rows.map((r) => r.no.toUpperCase())).size} (existing ${new Set(rows.map((r) => r.no.toUpperCase())).size - newComps.size}, NEW ${newComps.size})`);
console.log(`MPNs: new ${newMpns.size}, already in master ${rows.filter((r) => r.mpn).length - newMpns.size - mpnConflicts.length}`);
const show = (title, list) => { if (list.length) console.log(`\n${title} (${list.length}):\n  ${list.join("\n  ")}`); };
show("PROBLEM rows (skipped)", problems);
show("MPN CONFLICTS (MPN belongs to a different component)", mpnConflicts);
show("rows with no MPN", noMpn);
show("same component + MPN on more than one row (each becomes its own box)", dups);
show("existing components not box-tracked", nonBox);
show("name differs from master (master name kept)", nameMismatch);
show("NEW components to create (box tracking)", [...newComps.entries()].map(([no, n]) => `${no} — ${n}`));
show("NEW MPNs to add", [...newMpns.values()].map((m) => `${m.no}: ${m.mpn}`));

if (!go) { console.log("\n(dry run — nothing written. Re-run with --go)"); process.exit(0); }
if (problems.length || mpnConflicts.length) { console.error("\nNot importing: fix the problem rows / MPN conflicts first."); process.exit(1); }

// ---- 3. Write ----
const { data: admin } = await supa.from("profiles").select("id").eq("full_name", "Administrator").maybeSingle();
const actor = admin?.id ?? null;

for (const [no, name] of newComps) {
  const { data, error } = await supa.from("components")
    // tracking_mode 'box' and uom 'Nos' are enforced by CHECK constraints (0111, 0112).
    .insert({ component_no: no, name, tracking_mode: "box", uom: "Nos", created_by: actor })
    .select("id, component_no, name, tracking_mode, uom").single();
  if (error) { console.error(`create component ${no}: ${error.message}`); process.exit(1); }
  compByNo.set(no.toUpperCase(), data);
  console.log(`+ component ${no}`);
}
for (const m of newMpns.values()) {
  const c = compByNo.get(m.no.toUpperCase());
  const { data, error } = await supa.from("component_mpns").insert({ component_id: c.id, mpn: m.mpn, created_by: actor }).select("id, component_id, mpn").single();
  if (error) { console.error(`create MPN ${m.mpn}: ${error.message}`); process.exit(1); }
  mpnByText.set(m.mpn.toUpperCase(), data);
}
console.log(`+ ${newMpns.size} MPNs`);

const { data: grnNo, error: noErr } = await supa.rpc("next_grn_no");
if (noErr) { console.error(noErr.message); process.exit(1); }
const label = "OPENING STOCK " + file.replace(/^.*[\\/]/, "").replace(/\.xlsx$/i, "");
const { data: grn, error: gErr } = await supa.from("grns")
  .insert({ grn_no: grnNo, challan_no: label, invoice_no: label, received_by: actor, created_by: actor })
  .select("id, grn_no").single();
if (gErr) { console.error(`create GRN: ${gErr.message}`); process.exit(1); }
console.log(`+ GRN ${grn.grn_no} (${grn.id})`);

let n = 0;
for (const r of rows) {
  const c = compByNo.get(r.no.toUpperCase());
  const m = r.mpn ? mpnByText.get(r.mpn.toUpperCase()) : null;
  const { error } = await supa.from("grn_lines").insert({
    grn_id: grn.id, component_id: c.id, qty_received: r.qty, mpn_id: m?.id ?? null, created_by: actor,
  });
  if (error) { console.error(`GRN line for row ${r.row} (${r.no} ${r.mpn ?? ""}): ${error.message}\n${n} lines were added before this.`); process.exit(1); }
  n++;
}
console.log(`+ ${n} GRN lines`);

const { data: lineIds } = await supa.from("grn_lines").select("id").eq("grn_id", grn.id);
const lots = [];
for (let i = 0; i < lineIds.length; i += 100) {
  const { data } = await supa.from("inventory_lots").select("id, qty_on_hand, container_no").in("grn_line_id", lineIds.slice(i, i + 100).map((l) => l.id));
  lots.push(...(data ?? []));
}
const total = lots.reduce((s, l) => s + Number(l.qty_on_hand), 0);
console.log(`\nlots created: ${lots.length} (box lots: ${lots.filter((l) => l.container_no).length}), total on hand: ${total}`);
console.log(`GRN page: /grn/${grn.id}`);

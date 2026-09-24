/**
 * One-time import of Components.xlsx (project root): a flat matrix of
 * Webber part code / Description / Part No. (MPN) against 7 board SKUs,
 * each cell the quantity of that component used on that board.
 *
 * Run once: npm run import:components-bom
 */
import * as path from "node:path";
import * as XLSX from "xlsx";
import { adminClient } from "./_client";

const FILE = path.join(process.cwd(), "Components.xlsx");

type ComponentRow = { component_no: string; name: string; mpn: string | null; qtyBySku: Record<string, number> };

function readRows(): { skuNames: string[]; rows: ComponentRow[] } {
  const wb = XLSX.readFile(FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const header = (aoa[0] ?? []).map((h) => String(h ?? "").trim());
  const skuNames = header.slice(3);

  const rows: ComponentRow[] = [];
  for (const r of aoa.slice(1)) {
    const component_no = String(r?.[0] ?? "").trim();
    if (!component_no) continue;
    const name = String(r?.[1] ?? "").trim();
    const mpn = String(r?.[2] ?? "").trim() || null;
    const qtyBySku: Record<string, number> = {};
    skuNames.forEach((sku, i) => {
      const raw = r?.[3 + i];
      const qty = typeof raw === "number" ? raw : Number(raw ?? 0) || 0;
      if (qty > 0) qtyBySku[sku] = qty;
    });
    rows.push({ component_no, name, mpn, qtyBySku });
  }
  return { skuNames, rows };
}

async function main() {
  const { skuNames, rows } = readRows();
  console.log(`Parsed ${rows.length} components across ${skuNames.length} SKUs.`);
  const supa = adminClient();

  // ---- 1. Components (upsert on component_no) ----
  const componentIdByCno = new Map<string, string>();
  for (const r of rows) {
    const { data: existing } = await supa.from("components").select("id").eq("component_no", r.component_no).maybeSingle();
    if (existing) {
      const { error } = await supa.from("components")
        .update({ name: r.name, mpn: r.mpn, tracking_mode: "box", quantity_type: "nos", uom: "Nos" })
        .eq("id", existing.id);
      if (error) throw new Error(`update ${r.component_no}: ${error.message}`);
      componentIdByCno.set(r.component_no, existing.id);
    } else {
      const { data, error } = await supa.from("components")
        .insert({ component_no: r.component_no, name: r.name, mpn: r.mpn, tracking_mode: "box", quantity_type: "nos", uom: "Nos" })
        .select("id").single();
      if (error) throw new Error(`insert ${r.component_no}: ${error.message}`);
      componentIdByCno.set(r.component_no, data.id);
    }
  }
  console.log(`Components upserted: ${componentIdByCno.size}`);

  // ---- 2. Products (one per SKU column, upsert on sku_code) ----
  const productIdBySku = new Map<string, string>();
  for (const sku of skuNames) {
    const { data: existing } = await supa.from("products").select("id").eq("sku_code", sku).maybeSingle();
    if (existing) {
      productIdBySku.set(sku, existing.id);
    } else {
      const { data, error } = await supa.from("products")
        .insert({ sku_code: sku, model_name: sku, category_id: null, is_serialized: false })
        .select("id").single();
      if (error) throw new Error(`insert product ${sku}: ${error.message}`);
      productIdBySku.set(sku, data.id);
    }
  }
  console.log(`Products upserted: ${productIdBySku.size}`);

  // ---- 3. BOM templates + lines (one active template per product) ----
  for (const sku of skuNames) {
    const productId = productIdBySku.get(sku)!;
    let { data: template } = await supa.from("bom_templates")
      .select("id").eq("product_id", productId).eq("is_active", true).maybeSingle();
    if (!template) {
      const { data, error } = await supa.from("bom_templates")
        .insert({ product_id: productId, version: 1, is_active: true })
        .select("id").single();
      if (error) throw new Error(`insert bom_template ${sku}: ${error.message}`);
      template = data;
    }

    const { data: existingLines } = await supa.from("bom_template_lines")
      .select("component_id").eq("bom_template_id", template.id);
    const existingComponentIds = new Set((existingLines ?? []).map((l) => l.component_id));

    const linesToInsert = rows
      .filter((r) => r.qtyBySku[sku] && !existingComponentIds.has(componentIdByCno.get(r.component_no)!))
      .map((r) => ({
        bom_template_id: template!.id,
        component_id: componentIdByCno.get(r.component_no)!,
        quantity: r.qtyBySku[sku],
      }));

    if (linesToInsert.length > 0) {
      const { error } = await supa.from("bom_template_lines").insert(linesToInsert);
      if (error) throw new Error(`insert lines for ${sku}: ${error.message}`);
    }
    console.log(`  ${sku}: ${linesToInsert.length} new lines (${existingComponentIds.size} already present)`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("import-components-bom failed:", e.message ?? e);
  process.exit(1);
});

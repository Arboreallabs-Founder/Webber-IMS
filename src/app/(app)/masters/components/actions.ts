"use server";

import { upsertRecord, deleteRecord, type ActionResult } from "@/lib/server/crud";
import { createClient } from "@/lib/supabase/server";

const FIELDS = {
  component_no: "string",
  mpn: "string",
  name: "string",
  description: "string",
  type: "string",
  grade: "string",
  spec: "string",
  uom: "string",
  quantity_type: "string",
  tracking_mode: "string",
  raw_supplier_id: "string",
  standard_cost: "number",
  inspection_template_id: "string",
} as const;

export async function upsert(fd: FormData): Promise<ActionResult> {
  const res = await upsertRecord("components", FIELDS, fd);
  if (res.error) return res;

  // A supplier tag implies that vendor supplies this component — keep
  // vendor_components (which drives the GRN vendor-scoped picker and
  // vendor suggestions) in sync. One-directional only: never removes a
  // previously-added tag, since a component can have more than one valid
  // supplier and changing the "primary" supplier doesn't invalidate that.
  const rawSupplierId = String(fd.get("raw_supplier_id") ?? "").trim();
  const componentId = res.id ?? String(fd.get("id") ?? "");
  if (rawSupplierId && componentId) {
    const supabase = await createClient();
    await supabase
      .from("vendor_components")
      .upsert({ vendor_id: rawSupplierId, component_id: componentId }, { onConflict: "vendor_id,component_id" });
  }
  return res;
}
export async function remove(fd: FormData): Promise<ActionResult> {
  return deleteRecord("components", fd);
}

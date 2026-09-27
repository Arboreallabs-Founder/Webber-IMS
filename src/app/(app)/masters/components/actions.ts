"use server";

import { upsertRecord, deleteRecord, type ActionResult } from "@/lib/server/crud";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

const FIELDS = {
  component_no: "string",
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
  const supabase = await createClient();
  if (rawSupplierId && componentId) {
    await supabase
      .from("vendor_components")
      .upsert({ vendor_id: rawSupplierId, component_id: componentId }, { onConflict: "vendor_id,component_id" });
  }

  // MPNs: the same WPC can be sourced from more than one manufacturer, so a
  // component carries a list, submitted one per line. Replace the full set on
  // every save — simplest correct approach for a short, order-independent list.
  if (componentId) {
    const mpns = String(fd.get("mpns") ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (mpns.length > 0) {
      const { data: conflicts } = await supabase
        .from("component_mpns")
        .select("mpn, components(component_no)")
        .in("mpn", mpns)
        .neq("component_id", componentId);
      if (conflicts && conflicts.length > 0) {
        const c = conflicts[0] as unknown as { mpn: string; components: { component_no: string } | { component_no: string }[] | null };
        const other = Array.isArray(c.components) ? c.components[0] : c.components;
        return { error: `MPN "${c.mpn}" is already used by another component (${other?.component_no ?? "—"}).` };
      }
    }

    await supabase.from("component_mpns").delete().eq("component_id", componentId);
    if (mpns.length > 0) {
      const profile = await getProfile();
      const { error } = await supabase
        .from("component_mpns")
        .insert(mpns.map((mpn) => ({ component_id: componentId, mpn, created_by: profile?.id })));
      if (error) return { error: error.message.includes("component_mpns_mpn_key") ? "One of these MPNs is already used by another component." : error.message };
    }
  }

  // Approved alternatives: symmetric — both (this, alt) and (alt, this) are
  // stored, so any lookup on either component returns the full set with a
  // plain filter. Replace the full set on every save, same as MPNs above.
  if (componentId) {
    const altIds = String(fd.get("alternative_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== componentId);

    const { data: existing } = await supabase
      .from("component_alternatives")
      .select("alternative_id")
      .eq("component_id", componentId);
    const existingIds = new Set((existing ?? []).map((r) => r.alternative_id));
    const nextIds = new Set(altIds);

    const toAdd = altIds.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !nextIds.has(id));

    if (toAdd.length > 0) {
      const profile = await getProfile();
      const rows = toAdd.flatMap((altId) => [
        { component_id: componentId, alternative_id: altId, created_by: profile?.id },
        { component_id: altId, alternative_id: componentId, created_by: profile?.id },
      ]);
      const { error } = await supabase
        .from("component_alternatives")
        .upsert(rows, { onConflict: "component_id,alternative_id" });
      if (error) return { error: error.message };
    }
    for (const altId of toRemove) {
      await supabase.from("component_alternatives").delete().eq("component_id", componentId).eq("alternative_id", altId);
      await supabase.from("component_alternatives").delete().eq("component_id", altId).eq("alternative_id", componentId);
    }
  }

  return res;
}
export async function remove(fd: FormData): Promise<ActionResult> {
  return deleteRecord("components", fd);
}

/** Add a single MPN to an existing component — used by GRN's inline "add new MPN" popup. */
export async function addMpn(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { error: "Not authorized." };
  const componentId = String(fd.get("component_id") ?? "").trim();
  const mpn = String(fd.get("mpn") ?? "").trim();
  if (!componentId) return { error: "Missing component." };
  if (!mpn) return { error: "Enter an MPN." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("component_mpns")
    .insert({ component_id: componentId, mpn, created_by: profile.id })
    .select("id").single();
  if (error) {
    return { error: error.message.includes("component_mpns_mpn_key") ? "This MPN already exists on another component." : error.message };
  }
  return { ok: true, id: data.id };
}

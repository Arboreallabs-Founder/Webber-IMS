import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";
import { MASTER_TAGS } from "@/lib/masters-data";

export type ParseType = "string" | "number" | "boolean";
export type ActionResult = { ok?: true; error?: string; redirect?: string; id?: string };

// Tables backed by a cached getter in src/lib/masters-data.ts — invalidate on
// every successful write so the cache never serves stale data past this
// request. `components` backs both the full and financial-masked cache
// entries (v_components_safe is a view over it), so a write there must
// invalidate both.
const TABLE_TAGS: Record<string, readonly string[]> = {
  vendors: [MASTER_TAGS.vendors],
  customers: [MASTER_TAGS.customers],
  categories: [MASTER_TAGS.categories],
  components: [MASTER_TAGS.componentsFull, MASTER_TAGS.componentsSafe],
};

/**
 * Invalidate everything a write to `table` could be showing anywhere.
 *
 * Tables with a cached getter are invalidated precisely, by tag. The rest —
 * products, bom_templates, bom_template_lines, product_variant_params,
 * inspection_templates, inspection_template_fields, vendor_components,
 * projects — had no invalidation at all, so an edit on one device could leave
 * another device (or a later render on the same one) showing the old row.
 *
 * They get a whole-tree revalidation rather than a per-path list: their rows
 * are read across a wide and shifting set of routes (a BOM template line shows
 * up under masters, the BOM builder, and every project page that expands it),
 * and enumerating those is exactly the kind of list that silently goes stale.
 * Master data is edited rarely, so paying for a broad invalidation on write is
 * the right trade against serving a stale row.
 */
export function invalidateMasterCache(table: string) {
  const tags = TABLE_TAGS[table];
  if (tags) {
    for (const tag of tags) revalidateTag(tag);
    return;
  }
  revalidatePath("/", "layout");
}

/**
 * Generic upsert for master tables. Parses FormData by field spec, enforces
 * master-write role, and inserts or updates depending on presence of `id`.
 */
export async function upsertRecord(
  table: string,
  fields: Record<string, ParseType>,
  fd: FormData,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) return { error: "You don't have permission to edit master data." };

  const supabase = await createClient();
  const id = fd.get("id");
  const payload: Record<string, unknown> = {};

  for (const [name, parse] of Object.entries(fields)) {
    if (parse === "boolean") {
      const v = fd.get(name);
      payload[name] = v !== null && v !== "false" && v !== "off";
      continue;
    }
    const raw = fd.get(name);
    if (raw === null) continue;
    const s = String(raw).trim();
    if (parse === "number") payload[name] = s === "" ? null : Number(s);
    else payload[name] = s === "" ? null : s;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from(table as any) as any;
  let resp;
  if (id) {
    resp = await tbl.update(payload).eq("id", String(id)).select("id").single();
  } else {
    payload.created_by = profile!.id;
    resp = await tbl.insert(payload).select("id").single();
  }
  if (resp.error) return { error: friendlyError(resp.error.message, resp.error.code) };
  invalidateMasterCache(table);
  return { ok: true, id: resp.data?.id };
}

/**
 * Upsert with a pre-built payload (for tables with JSONB / computed fields that
 * the generic FormData parser can't handle, e.g. variant params, BOM template lines).
 */
export async function upsertRaw(
  table: string,
  payload: Record<string, unknown>,
  id?: string | null,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) return { error: "You don't have permission to edit master data." };
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = supabase.from(table as any) as any;
  let resp;
  if (id) resp = await tbl.update(payload).eq("id", id);
  else resp = await tbl.insert({ ...payload, created_by: profile!.id });
  if (resp.error) return { error: friendlyError(resp.error.message, resp.error.code) };
  invalidateMasterCache(table);
  return { ok: true };
}

/** Parse a free-text options string into a JSONB-ready array (JSON or comma list). */
export function parseOptions(raw: string): unknown {
  const s = raw.trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((v) => (v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v));
  }
}

export async function deleteRecord(table: string, fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) return { error: "You don't have permission to delete master data." };
  const id = fd.get("id");
  if (!id) return { error: "Missing id." };
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await (supabase.from(table as any) as any).delete().eq("id", String(id));
  if (resp.error) return { error: friendlyError(resp.error.message, resp.error.code) };
  invalidateMasterCache(table);
  return { ok: true };
}

function friendlyError(msg: string, code?: string) {
  if (code === "23505" || msg.includes("duplicate key")) return "A record with that unique value already exists.";
  if (code === "23503" || (msg.includes("foreign key") && msg.includes("still referenced")))
    return "Can't delete — this record is referenced by other data.";
  if (msg.includes("violates row-level security")) return "Not authorized for this action.";
  if (msg.includes("chk_components_irn_not_box"))
    return "Box-tracked components can't have an inspection template attached — only Item or Bulk.";
  return msg;
}

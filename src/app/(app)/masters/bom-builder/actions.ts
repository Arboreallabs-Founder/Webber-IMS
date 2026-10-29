"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";
import type { ActionResult } from "@/lib/server/crud";
import { upsert as categoryUpsert, remove as categoryRemove } from "../categories/actions";
import { upsert as componentUpsert } from "../components/actions";
import {
  upsertTemplateLine as templateLineUpsert,
  removeTemplateLine as templateLineRemove,
} from "../bom-templates/actions";
import {
  upsertVariantParam as variantParamUpsert,
  removeVariantParam as variantParamRemove,
} from "../products/actions";

// The BOM Builder reuses the existing master-data write actions for anything
// that already has one; a "use server" file can't re-export, so wrap them.
export async function createCategoryQuick(fd: FormData): Promise<ActionResult> {
  return categoryUpsert(fd);
}
export async function createComponentQuick(fd: FormData): Promise<ActionResult> {
  return componentUpsert(fd);
}
export async function updateCategory(fd: FormData): Promise<ActionResult> {
  return categoryUpsert(fd);
}
export async function removeCategory(fd: FormData): Promise<ActionResult> {
  return categoryRemove(fd);
}
export async function upsertTemplateLine(fd: FormData): Promise<ActionResult> {
  return templateLineUpsert(fd);
}
export async function removeTemplateLine(fd: FormData): Promise<ActionResult> {
  return templateLineRemove(fd);
}
export async function upsertVariantParam(fd: FormData): Promise<ActionResult> {
  return variantParamUpsert(fd);
}
export async function removeVariantParam(fd: FormData): Promise<ActionResult> {
  return variantParamRemove(fd);
}

/**
 * Start a BOM from scratch: (optionally) create a category, create the product,
 * and create its active BOM template — then drop the user straight into the
 * builder for that template.
 */
export async function startBom(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) {
    return { error: "You don't have permission to edit master data." };
  }
  const supabase = await createClient();

  const skuCode = String(fd.get("sku_code") ?? "").trim();
  const modelName = String(fd.get("model_name") ?? "").trim();
  if (!skuCode || !modelName) return { error: "SKU code and model name are both required." };

  // Category (when typed in), product and its BOM are created together in one
  // transaction, so a failure part-way can't leave a product with no BOM.
  const { data: templateId, error } = await supabase.rpc("start_product_bom", {
    p_sku: skuCode,
    p_model: modelName,
    p_category_id: String(fd.get("category_id") ?? "").trim() || undefined,
    p_new_category: String(fd.get("new_category_name") ?? "").trim() || undefined,
    p_is_serialized: fd.get("is_serialized") !== null && fd.get("is_serialized") !== "false",
  });
  if (error) return { error: error.message };

  revalidatePath("/masters/bom-builder");
  return { ok: true, redirect: `/masters/bom-builder/${templateId as string}` };
}

/** Edit the product header (model / SKU / category) from inside the builder. */
export async function updateProduct(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) {
    return { error: "You don't have permission to edit master data." };
  }
  const supabase = await createClient();

  const id = String(fd.get("id") ?? "").trim();
  if (!id) return { error: "Missing product id." };

  const payload: Record<string, unknown> = {};
  const sku = String(fd.get("sku_code") ?? "").trim();
  const model = String(fd.get("model_name") ?? "").trim();
  if (sku) payload.sku_code = sku;
  if (model) payload.model_name = model;
  if (fd.has("category_id")) payload.category_id = String(fd.get("category_id") ?? "").trim() || null;
  if (fd.has("description")) payload.description = String(fd.get("description") ?? "").trim() || null;
  if (fd.has("is_serialized")) {
    const v = fd.get("is_serialized");
    payload.is_serialized = v !== null && v !== "false" && v !== "off";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("products") as any).update(payload).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/masters/bom-builder");
  return { ok: true };
}

/**
 * Promote a plain sub-assembly folder line into a reusable, stock-trackable
 * sub-assembly (component + its own template). Atomic — see migration 0090.
 */
export async function promoteAssemblyLine(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) {
    return { error: "You don't have permission to edit master data." };
  }
  const supabase = await createClient();

  const lineId = String(fd.get("line_id") ?? "").trim();
  if (!lineId) return { error: "Missing line id." };
  const componentNo = String(fd.get("component_no") ?? "").trim() || null;

  const { data, error } = await supabase.rpc("promote_assembly_line", {
    p_line: lineId,
    p_component_no: componentNo ?? undefined,
  });
  if (error) return { error: error.message };

  revalidatePath("/masters/bom-builder");
  revalidatePath("/masters/bom-templates");
  return { ok: true, id: (data as string) ?? undefined };
}

/** Duplicate a whole product BOM (new product + template + variant params + lines). */
export async function duplicateBom(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) {
    return { error: "You don't have permission to edit master data." };
  }
  const supabase = await createClient();

  const templateId = String(fd.get("template_id") ?? "").trim();
  if (!templateId) return { error: "Missing template id." };
  const sku = String(fd.get("sku_code") ?? "").trim();
  const model = String(fd.get("model_name") ?? "").trim();
  if (!sku || !model) return { error: "New SKU code and model name are both required." };

  const { data, error } = await supabase.rpc("duplicate_product_bom", {
    p_src_template: templateId,
    p_sku: sku,
    p_model: model,
  });
  if (error) return { error: error.message };

  revalidatePath("/masters/bom-builder");
  return { ok: true, redirect: `/masters/bom-builder/${data as string}` };
}

/**
 * Delete a whole product BOM: removes the product (cascades its template,
 * template lines, and variant params). Refuses if a project or finished good
 * still references the product.
 */
export async function deleteBom(fd: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!canWriteMasters(profile?.role)) {
    return { error: "You don't have permission to edit master data." };
  }
  const supabase = await createClient();

  const templateId = String(fd.get("template_id") ?? "").trim();
  if (!templateId) return { error: "Missing template id." };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tpl } = await (supabase.from("bom_templates") as any)
    .select("product_id")
    .eq("id", templateId)
    .maybeSingle();
  if (!tpl?.product_id) return { error: "This isn't a product BOM template." };
  const productId = tpl.product_id as string;

  const [{ count: pliCount }, { count: fgCount }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from("project_line_items") as any).select("id", { count: "exact", head: true }).eq("product_id", productId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from("finished_goods") as any).select("id", { count: "exact", head: true }).eq("product_id", productId),
  ]);
  if ((pliCount ?? 0) > 0) return { error: `Can't delete — this product is used on ${pliCount} project line item(s).` };
  if ((fgCount ?? 0) > 0) return { error: `Can't delete — this product has ${fgCount} finished-good record(s).` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("products") as any).delete().eq("id", productId);
  if (error) return { error: error.message };

  revalidatePath("/masters/bom-builder");
  revalidatePath("/masters/bom-templates");
  revalidatePath("/masters/products");
  return { ok: true };
}

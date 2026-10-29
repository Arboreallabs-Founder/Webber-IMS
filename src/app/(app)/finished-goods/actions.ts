"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string; message?: string };
const PRODUCE = ["admin", "team_lead"];

async function producer() {
  const p = await getProfile();
  return p && PRODUCE.includes(p.role) ? p : null;
}

// Logged from the project page (see finished-goods-form.tsx) — not a bare
// standalone form. Gated server-side by log_finished_goods() on an
// approved BOM and at least one issue against the project.
export async function logFinishedGoods(fd: FormData): Promise<ActionResult> {
  const p = await producer();
  if (!p) return { error: "Only Admin / Team Lead can log finished goods." };

  const project_id = String(fd.get("project_id") ?? "");
  const project_line_item_id = String(fd.get("project_line_item_id") ?? "") || null;
  const source = String(fd.get("source") ?? "product");
  const product_id = !project_line_item_id && source === "product" ? String(fd.get("product_id") ?? "") || null : null;
  const custom_name = !project_line_item_id && source === "custom" ? String(fd.get("custom_name") ?? "").trim() || null : null;
  const quantity = Number(fd.get("quantity") ?? 1);

  if (!project_id) return { error: "Missing project." };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Enter a valid quantity." };
  if (!project_line_item_id && !product_id && !custom_name) return { error: "Pick a product or enter a custom name." };

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("log_finished_goods", {
    p_project_id: project_id,
    p_project_line_item_id: project_line_item_id,
    p_product_id: product_id,
    p_custom_name: custom_name,
    p_quantity: quantity,
    p_user_id: p.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/finished-goods");
  revalidatePath(`/projects/${project_id}`);
  return { ok: true, message: `Logged ${(rows ?? []).length} finished unit${quantity > 1 ? "s" : ""}.` };
}

export async function updateFgStatus(fd: FormData): Promise<ActionResult> {
  const p = await producer();
  if (!p) return { error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("finished_goods")
    .update({ status: String(fd.get("status")) })
    .eq("id", String(fd.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/finished-goods");
  return { ok: true };
}

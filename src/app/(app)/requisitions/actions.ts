"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string; id?: string };

const PROCURE = ["admin", "team_lead", "inventory_admin"];
const REQUEST = ["admin", "team_lead", "team_member", "inventory_admin", "floor"];

async function profileWith(roles: string[]) {
  const p = await getProfile();
  return p && roles.includes(p.role) ? p : null;
}

export async function removeRequisition(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(PROCURE);
  if (!p) return { error: "Not authorized." };
  const supabase = await createClient();
  const { error } = await supabase.from("requisitions").delete().eq("id", String(fd.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/requisitions");
  return { ok: true };
}

export async function updateReqStatus(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(PROCURE);
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("requisitions")
    .update({ status: String(fd.get("status")) })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/requisitions/${id}`);
  return { ok: true };
}

export async function issueRequisition(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(PROCURE);
  if (!p) return { error: "Only Admin / Team Lead / Inventory Admin can issue requisitions." };
  const requisition_id = String(fd.get("requisition_id"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_requisition", {
    p_req_id: requisition_id,
    p_user_id: p.id,
  });
  if (error) {
    const msg = error.message.includes("INSUFFICIENT_STOCK:")
      ? error.message.replace(/^.*INSUFFICIENT_STOCK: /, "Insufficient stock — ")
      : error.message;
    return { error: msg };
  }
  if (data?.error) return { error: data.error };
  revalidatePath(`/requisitions/${requisition_id}`);
  return { ok: true };
}

/**
 * Raises a requisition for the components ticked in a project's stock check,
 * at the quantities confirmed in the pop-up. Each one must have stock in hand
 * (open, or blocked for this project) and its qty can't exceed what the BOM
 * still needs — required less consumed and out at job-work. Both are
 * re-checked here from v_project_shortfall rather than trusting the client.
 * Nothing is blocked: the stock is scanned and consumed on the requisition.
 */
export async function raiseRequisitionInStock(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(PROCURE);
  if (!p) return { error: "Only Admin / Team Lead / Inventory Admin can raise requisitions." };
  const project_id = String(fd.get("project_id"));
  let items: { component_id: string; qty: number }[];
  try {
    items = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    return { error: "Bad request." };
  }
  if (!Array.isArray(items) || items.length === 0) return { error: "Tick at least one component in stock." };
  if (new Set(items.map((i) => i.component_id)).size !== items.length) return { error: "A component is listed twice." };

  const supabase = await createClient();
  const [{ data: rows }, { data: comps }] = await Promise.all([
    supabase
      .from("v_project_shortfall")
      .select("component_id, required_qty, consumed_qty, sent_to_jw_qty, on_hand")
      .eq("project_id", project_id)
      .in("component_id", items.map((i) => i.component_id)),
    supabase.from("components").select("id, component_no").in("id", items.map((i) => i.component_id)),
  ]);
  const byComponent = new Map((rows ?? []).map((r) => [r.component_id, r]));
  const compNo = new Map((comps ?? []).map((c) => [c.id, c.component_no]));

  // Re-checked here from the live shortfall: only components with stock in
  // hand, and never more than the BOM still needs.
  const lines: { component_id: string; qty: number }[] = [];
  for (const i of items) {
    const name = compNo.get(i.component_id) ?? "A component";
    const r = byComponent.get(i.component_id);
    const qty = Number(i.qty);
    if (!r) return { error: `${name} isn't on this project's BOM.` };
    const stillNeeded = Math.max(Number(r.required_qty ?? 0) - Number(r.consumed_qty ?? 0) - Number(r.sent_to_jw_qty ?? 0), 0);
    if (!(Number(r.on_hand ?? 0) > 0) || stillNeeded <= 0) return { error: `${name} has no stock in hand that this project still needs.` };
    if (!(qty > 0)) return { error: `${name}: enter a quantity above 0.` };
    if (qty > stillNeeded) return { error: `${name}: the BOM only still needs ${stillNeeded}.` };
    lines.push({ component_id: i.component_id, qty });
  }

  const { data: reqNo } = await supabase.rpc("next_req_no");
  const { data: req, error } = await supabase
    .from("requisitions")
    .insert({ req_no: reqNo, project_id, status: "open", requested_by: p.id, created_by: p.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  const { error: lErr } = await supabase.from("requisition_lines").insert(
    lines.map((l) => ({
      requisition_id: req.id,
      component_id: l.component_id,
      qty: l.qty,
      shortfall_qty: 0,
      created_by: p.id,
    })),
  );
  if (lErr) return { error: lErr.message };
  revalidatePath("/requisitions");
  return { ok: true, id: req.id };
}

export async function removeReqLine(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(REQUEST);
  if (!p) return { error: "Not authorized." };
  const requisition_id = String(fd.get("requisition_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("requisition_lines").delete().eq("id", String(fd.get("id")));
  if (error) return { error: error.message };
  revalidatePath(`/requisitions/${requisition_id}`);
  return { ok: true };
}

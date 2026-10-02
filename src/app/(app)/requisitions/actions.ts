"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string; id?: string };

const PROCURE = ["admin", "team_lead", "inventory_admin"];
const REQUEST = ["admin", "team_lead", "team_member", "inventory_admin"];

async function profileWith(roles: string[]) {
  const p = await getProfile();
  return p && roles.includes(p.role) ? p : null;
}

export async function createRequisition(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(REQUEST);
  if (!p) return { error: "Not authorized." };
  const project_id = String(fd.get("project_id") ?? "") || null;
  if (!project_id) return { error: "Project is required." };
  const supabase = await createClient();
  const { data: reqNo } = await supabase.rpc("next_req_no");
  const { data, error } = await supabase
    .from("requisitions")
    .insert({ req_no: reqNo, project_id, status: "open", requested_by: p.id, created_by: p.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/requisitions");
  return { ok: true, id: data.id };
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
 * Raises a requisition for exactly the components a project's BOM still
 * needs that are actually sitting in stock right now — never for a
 * component that's short. "Still needs" nets off what's already been
 * consumed or is currently out at job-work; the requisitioned qty is
 * capped at on-hand, so a partially-covered line only requisitions the
 * covered part. Re-derives everything server-side from
 * v_project_shortfall rather than trusting client-passed numbers.
 */
export async function raiseRequisitionInStock(fd: FormData): Promise<ActionResult> {
  const p = await profileWith(PROCURE);
  if (!p) return { error: "Only Admin / Team Lead / Inventory Admin can raise requisitions." };
  const project_id = String(fd.get("project_id"));
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("v_project_shortfall")
    .select("component_id, required_qty, consumed_qty, sent_to_jw_qty, on_hand")
    .eq("project_id", project_id);

  const lines = (rows ?? [])
    .map((r) => {
      const remaining = Math.max(Number(r.required_qty ?? 0) - Number(r.consumed_qty ?? 0) - Number(r.sent_to_jw_qty ?? 0), 0);
      const qty = Math.min(remaining, Number(r.on_hand ?? 0));
      return { component_id: r.component_id, qty };
    })
    .filter((l) => l.component_id && l.qty > 0);
  if (lines.length === 0) return { error: "No in-stock components to requisition." };

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

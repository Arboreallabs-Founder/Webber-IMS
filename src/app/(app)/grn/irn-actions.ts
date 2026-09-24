"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string; id?: string; irn_no?: string; status?: string };

const RECEIVE = ["admin", "team_lead", "team_member"];

async function receiver() {
  const p = await getProfile();
  return p && RECEIVE.includes(p.role) ? p : null;
}

function num(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

export async function submitIrn(fd: FormData): Promise<ActionResult> {
  const p = await receiver();
  if (!p) return { error: "Not authorized." };
  const grn_id = String(fd.get("grn_id") ?? "");
  const component_id = String(fd.get("component_id") ?? "");
  if (!grn_id || !component_id) return { error: "Missing GRN or component." };
  const qty = num(fd, "qty_received");
  if (!qty || qty <= 0) return { error: "Enter a received quantity." };
  const po_line_id = String(fd.get("po_line_id") ?? "") || null;

  let answers: unknown = [];
  try {
    answers = JSON.parse(String(fd.get("answers") ?? "[]"));
  } catch {
    return { error: "Invalid inspection answers." };
  }

  const supabase = await createClient();

  // Best-effort: if the submitter has a saved signature, submit_irn can
  // auto-approve inline when they're Admin/Team Lead — same silent
  // no-op-if-missing pattern as createGrn's auto-sign.
  const { data: mySig } = await supabase
    .from("signatures")
    .select("id")
    .eq("user_id", p.id)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: result, error } = await supabase.rpc("submit_irn", {
    p_grn_id: grn_id,
    p_component_id: component_id,
    p_qty: qty,
    p_unit_cost: num(fd, "unit_cost"),
    p_po_line_id: po_line_id,
    p_project_id: String(fd.get("project_id") ?? "") || null,
    p_piece_count: num(fd, "piece_count"),
    p_piece_length: num(fd, "piece_length"),
    p_piece_width: num(fd, "piece_width"),
    p_answers: answers,
    p_submitter_id: p.id,
    p_target_lot_id: String(fd.get("target_lot_id") ?? "") || null,
    p_piece_weight: num(fd, "piece_weight"),
    p_signature_id: mySig?.id ?? null,
  });
  if (error) return { error: error.message };
  const res = result as { error?: string; id?: string; irn_no?: string; status?: string };
  if (res?.error) return { error: res.error };

  revalidatePath(`/grn/${grn_id}`);
  revalidatePath("/grn");
  return { ok: true, id: res.id, irn_no: res.irn_no, status: res.status };
}

async function approver() {
  const p = await getProfile();
  return canWriteMasters(p?.role) ? p : null;
}

export async function approveIrn(fd: FormData): Promise<ActionResult> {
  const p = await approver();
  if (!p) return { error: "Only Admin / Team Lead can approve." };
  const irn_id = String(fd.get("irn_id") ?? "");
  const signature_id = String(fd.get("signature_id") ?? "");
  if (!irn_id) return { error: "Missing IRN." };
  if (!signature_id) return { error: "Missing signature." };
  const remarks = String(fd.get("remarks") ?? "").trim() || null;
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("approve_irn", {
    p_irn_id: irn_id,
    p_approver_id: p.id,
    p_signature_id: signature_id,
    p_remarks: remarks,
  });
  if (error) return { error: error.message };
  const res = result as { error?: string };
  if (res?.error) return { error: res.error };
  revalidatePath("/grn");
  return { ok: true };
}

export async function rejectIrn(fd: FormData): Promise<ActionResult> {
  const p = await approver();
  if (!p) return { error: "Only Admin / Team Lead can reject." };
  const irn_id = String(fd.get("irn_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!irn_id) return { error: "Missing IRN." };
  if (!reason) return { error: "Enter a rejection reason." };
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("reject_irn", { p_irn_id: irn_id, p_approver_id: p.id, p_reason: reason });
  if (error) return { error: error.message };
  const res = result as { error?: string };
  if (res?.error) return { error: res.error };
  revalidatePath("/grn");
  return { ok: true };
}

export async function resubmitIrn(fd: FormData): Promise<ActionResult> {
  const p = await receiver();
  if (!p) return { error: "Not authorized." };
  const irn_id = String(fd.get("irn_id") ?? "");
  if (!irn_id) return { error: "Missing IRN." };
  let answers: unknown = [];
  try {
    answers = JSON.parse(String(fd.get("answers") ?? "[]"));
  } catch {
    return { error: "Invalid inspection answers." };
  }
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("resubmit_irn", { p_irn_id: irn_id, p_answers: answers, p_submitter_id: p.id });
  if (error) return { error: error.message };
  const res = result as { error?: string; id?: string; irn_no?: string; status?: string };
  if (res?.error) return { error: res.error };
  revalidatePath("/grn");
  return { ok: true, id: res.id, irn_no: res.irn_no, status: res.status };
}

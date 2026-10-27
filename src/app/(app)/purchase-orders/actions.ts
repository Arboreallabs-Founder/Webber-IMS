"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { canDeletePurchaseOrders, canApprovePoLine } from "@/lib/roles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePoTerms } from "@/lib/po-terms";

export type ActionResult = {
  ok?: true;
  error?: string;
  id?: string;
  /** Set when raising a PO produces more than one (grouped by supplier). */
  created?: { id: string; po_no: string; vendor_name: string | null }[];
  message?: string;
  /** Set when an edit to a sent PO created a new revision — client should navigate here. */
  revisedPoId?: string;
};

const LOCKED_PO_ERROR = "This PO is locked — it's been cancelled or superseded by a later revision and can no longer be edited.";

// Editing any of these creates a new revision (or, for header-only changes,
// saves in place) via clone_po_revision — only cancelled/superseded POs are
// permanently locked.
const EDITABLE_SENT_STATUSES = ["sent", "partial", "completed"];

const PROCURE = ["admin", "team_lead"];

async function procurer() {
  const p = await getProfile();
  return p && PROCURE.includes(p.role) ? p : null;
}

function num(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : Number(v);
}

function poNoError(error: { message: string; code?: string }): string {
  // The numbering trigger's own message names the clash (e.g. an older,
  // unpadded spelling of the same number) — only the bare constraint's is generic.
  if (error.code === "23505" && !error.message.startsWith("PO number")) return "A PO with that number already exists.";
  return error.message;
}

function deleteError(error: { message: string; code?: string }): string {
  if (error.code === "23503") return "Can't delete — goods have already been received against this PO.";
  return error.message;
}

async function recomputePoTotal(supabase: SupabaseClient, po_id: string) {
  const { data } = await supabase.from("po_lines").select("amount").eq("po_id", po_id);
  const total = (data ?? []).reduce((s, l) => s + Number(l.amount ?? 0), 0);
  await supabase.from("purchase_orders").update({ total_amount: total || null }).eq("id", po_id);
}

export async function createPO(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Only Admin / Team Lead can raise POs." };
  const supabase = await createClient();
  const manualPoNo = String(fd.get("po_no") ?? "").trim();
  // The dialog pre-fills the next number; if the user kept it and someone
  // else took it in the meantime, quietly move on to the next free one
  // instead of failing. A number the user typed themselves is never swapped.
  const keptSuggestion = !manualPoNo || manualPoNo === String(fd.get("suggested_po_no") ?? "").trim();
  if (fd.get("is_consumables") === "1" && !String(fd.get("vendor_id") ?? "").trim()) {
    return { error: "Pick the consumables vendor for this PO." };
  }
  let poNo = manualPoNo || (await supabase.rpc("next_po_no")).data;
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase
      .from("purchase_orders")
      .insert({
        po_no: poNo,
        vendor_id: String(fd.get("vendor_id") ?? "") || null,
        po_date: String(fd.get("po_date") ?? "") || null,
        status: "draft",
        source: "system",
        is_consumables: fd.get("is_consumables") === "1",
        created_by: p.id,
      })
      .select("id")
      .single();
    if (!error) {
      revalidatePath("/purchase-orders");
      revalidatePath("/consumables");
      return { ok: true, id: data.id };
    }
    if (error.code !== "23505" || !keptSuggestion || attempt >= 4) return { error: poNoError(error) };
    poNo = (await supabase.rpc("next_po_no")).data;
  }
}

export async function updatePO(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id"));
  const supabase = await createClient();

  const { data: po } = await supabase.from("purchase_orders").select("status, vendor_id, terms_conditions").eq("id", id).single();
  if (!po) return { error: "PO not found." };
  if (po.status !== "draft" && !EDITABLE_SENT_STATUSES.includes(po.status)) return { error: LOCKED_PO_ERROR };

  const po_no = String(fd.get("po_no") ?? "").trim();
  if (!po_no) return { error: "PO No. is required." };
  const vendor_id = String(fd.get("vendor_id") ?? "") || null;

  // A form without the field leaves the terms alone rather than wiping them.
  const terms_conditions = fd.has("terms_conditions")
    ? normalizePoTerms(String(fd.get("terms_conditions")))
    : po.terms_conditions;
  const termsChanged = terms_conditions !== normalizePoTerms(po.terms_conditions ?? "");

  // Changing the vendor or the terms on an already-sent/partial/completed PO
  // changes what was agreed with the vendor — treat it as a
  // revision-triggering change, same as a line edit. Both in one save make a
  // single revision.
  const vendorChanged = vendor_id !== po.vendor_id;
  if (EDITABLE_SENT_STATUSES.includes(po.status) && (vendorChanged || termsChanged)) {
    const { data: result, error } = await supabase.rpc("clone_po_revision", {
      p_old_po_id: id,
      p_kind: "header",
      p_line_id: null,
      p_patch: { ...(vendorChanged ? { vendor_id } : {}), ...(termsChanged ? { terms_conditions } : {}) },
      p_actor: p.id,
    });
    if (error) return { error: error.message };
    const res = result as { error?: string; id?: string };
    if (res?.error) return { error: res.error };
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${res.id}`);
    return { ok: true, id: res.id, revisedPoId: res.id };
  }

  const patch: Record<string, unknown> = {
    po_no,
    vendor_id,
    po_date: String(fd.get("po_date") ?? "") || null,
    delivery_terms: String(fd.get("delivery_terms") ?? "").trim() || "Urgent",
    payment_terms: String(fd.get("payment_terms") ?? "").trim() || "30 Days",
    freight_terms: String(fd.get("freight_terms") ?? "").trim() || "At Actual",
    delivery_address: String(fd.get("delivery_address") ?? "").replace(/\r\n/g, "\n").trim() || null,
    gst_percent: num(fd, "gst_percent") ?? 18,
    terms_conditions,
  };
  // Status is only ever manually settable while still draft, and only into
  // draft/cancelled — "sent" now only happens via signPo (the sign-off
  // chain), and partial/completed are automation-only outcomes of GRN
  // receiving. Ignored entirely once status has already moved on,
  // regardless of what's in the submitted form.
  if (po.status === "draft") {
    const status = String(fd.get("status") ?? "draft");
    if (!["draft", "cancelled"].includes(status)) return { error: "Invalid status." };
    patch.status = status;
  }

  const { error } = await supabase.from("purchase_orders").update(patch).eq("id", id);
  if (error) return { error: poNoError(error) };
  revalidatePath(`/purchase-orders/${id}`);
  return { ok: true };
}

export async function removePO(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id"));
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("status, revision_no, superseded_by, root_po_id").eq("id", id).single();
  if (!po) return { error: "PO not found." };
  if (!canDeletePurchaseOrders(p.role, po)) {
    return { error: "Only Admin / Founder can delete this PO, or Admin / Team Lead for an unrevised draft." };
  }

  // Deleting any PO in a revision chain deletes the whole lineage together
  // (the original + every R1/R2/... revision) — not just the one row you're
  // looking at. RLS still checks each row individually, so a Team Lead's
  // narrower rule (only a lone, never-revised draft) still applies: for
  // them this lineage query only ever resolves to the single row anyway.
  const rootId = po.root_po_id ?? id;
  const { data: lineage } = await supabase.from("purchase_orders").select("id").or(`id.eq.${rootId},root_po_id.eq.${rootId}`);
  const ids = (lineage ?? []).map((r) => r.id);

  const { error } = await supabase.from("purchase_orders").delete().in("id", ids.length ? ids : [id]);
  if (error) return { error: deleteError(error) };
  revalidatePath("/purchase-orders");
  return { ok: true };
}

export async function addPoLine(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Not authorized." };
  const po_id = String(fd.get("po_id"));
  const component_id = String(fd.get("component_id") ?? "");
  if (!component_id) return { error: "Pick a component." };
  const qty = num(fd, "qty_ordered") ?? 0;
  const rate = num(fd, "rate");
  let amount = num(fd, "amount");
  if (amount == null && rate != null) amount = rate * qty;
  const project_id = String(fd.get("project_id") ?? "") || null;
  const expected_date = String(fd.get("expected_date") ?? "") || null;

  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", po_id).single();
  if (!po) return { error: "PO not found." };

  if (EDITABLE_SENT_STATUSES.includes(po.status)) {
    const { data: result, error } = await supabase.rpc("clone_po_revision", {
      p_old_po_id: po_id,
      p_kind: "add",
      p_line_id: null,
      p_patch: { component_id, project_id, qty_ordered: qty, rate, amount, expected_date },
      p_actor: p.id,
    });
    if (error) return { error: error.message };
    const res = result as { error?: string; id?: string };
    if (res?.error) return { error: res.error };
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${res.id}`);
    return { ok: true, id: res.id, revisedPoId: res.id };
  }
  if (po.status !== "draft") return { error: LOCKED_PO_ERROR };

  const { error } = await supabase.from("po_lines").insert({
    po_id, component_id, project_id, qty_ordered: qty, rate, amount, expected_date, created_by: p.id,
  });
  if (error) return { error: error.message };
  await recomputePoTotal(supabase, po_id);
  revalidatePath(`/purchase-orders/${po_id}`);
  return { ok: true };
}

export async function updatePoLine(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id"));
  const po_id = String(fd.get("po_id"));
  const qty = num(fd, "qty_ordered") ?? 0;
  const rate = num(fd, "rate");
  let amount = num(fd, "amount");
  if (amount == null && rate != null) amount = rate * qty;
  const component_id = String(fd.get("component_id") ?? "") || null;
  const project_id = String(fd.get("project_id") ?? "") || null;
  const expected_date = String(fd.get("expected_date") ?? "") || null;

  const supabase = await createClient();
  const [{ data: po }, { data: line }] = await Promise.all([
    supabase.from("purchase_orders").select("status").eq("id", po_id).single(),
    supabase.from("po_lines").select("component_id, qty_ordered, rate").eq("id", id).single(),
  ]);
  if (!po) return { error: "PO not found." };
  if (!line) return { error: "Line not found." };

  // "What was ordered" — component/qty/rate — is what triggers a revision
  // on a sent PO. project_id/expected_date aren't part of the order itself
  // and always save in place.
  const contentChanged =
    (component_id ?? line.component_id) !== line.component_id ||
    qty !== Number(line.qty_ordered) ||
    rate !== (line.rate == null ? null : Number(line.rate));

  if (EDITABLE_SENT_STATUSES.includes(po.status) && contentChanged) {
    const { data: result, error } = await supabase.rpc("clone_po_revision", {
      p_old_po_id: po_id,
      p_kind: "update",
      p_line_id: id,
      p_patch: { component_id, project_id, qty_ordered: qty, rate, amount, expected_date },
      p_actor: p.id,
    });
    if (error) return { error: error.message };
    const res = result as { error?: string; id?: string };
    if (res?.error) return { error: res.error };
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${res.id}`);
    return { ok: true, id: res.id, revisedPoId: res.id };
  }
  if (po.status !== "draft" && !EDITABLE_SENT_STATUSES.includes(po.status)) return { error: LOCKED_PO_ERROR };

  const { error } = await supabase
    .from("po_lines")
    .update({ project_id, qty_ordered: qty, rate, amount, expected_date })
    .eq("id", id);
  if (error) return { error: error.message };
  await recomputePoTotal(supabase, po_id);
  revalidatePath(`/purchase-orders/${po_id}`);
  return { ok: true };
}

export async function removePoLine(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id"));
  const po_id = String(fd.get("po_id"));
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", po_id).single();
  if (!po) return { error: "PO not found." };

  if (EDITABLE_SENT_STATUSES.includes(po.status)) {
    const { data: result, error } = await supabase.rpc("clone_po_revision", {
      p_old_po_id: po_id,
      p_kind: "remove",
      p_line_id: id,
      p_patch: {},
      p_actor: p.id,
    });
    if (error) return { error: error.message };
    const res = result as { error?: string; id?: string };
    if (res?.error) return { error: res.error };
    revalidatePath("/purchase-orders");
    revalidatePath(`/purchase-orders/${res.id}`);
    return { ok: true, id: res.id, revisedPoId: res.id };
  }
  if (po.status !== "draft") return { error: LOCKED_PO_ERROR };

  const { error } = await supabase.from("po_lines").delete().eq("id", id);
  if (error) return { error: error.message };
  await recomputePoTotal(supabase, po_id);
  revalidatePath(`/purchase-orders/${po_id}`);
  return { ok: true };
}

// ---- price approval: gated to the configured PO approver (Masters →
// Approval Rights, slot 2) — falls back to Admin-only until that's configured ----
async function poApprover() {
  const p = await getProfile();
  if (!p) return null;
  const supabase = await createClient();
  const { data: right } = await supabase
    .from("approval_rights")
    .select("user_id")
    .eq("document_type", "po")
    .eq("approver_order", 2)
    .maybeSingle();
  return canApprovePoLine(p.role, p.id, right?.user_id ?? null) ? p : null;
}

export async function approvePoLine(fd: FormData): Promise<ActionResult> {
  const p = await poApprover();
  if (!p) return { error: "You are not the configured PO approver." };
  const line_id = String(fd.get("line_id") ?? "");
  const signature_id = String(fd.get("signature_id") ?? "");
  if (!line_id) return { error: "Missing PO line." };
  if (!signature_id) return { error: "Pick a signature." };
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("approve_po_line", { p_line_id: line_id, p_signature_id: signature_id, p_actor: p.id });
  if (error) return { error: error.message };
  const res = result as { error?: string };
  if (res?.error) return { error: res.error };
  revalidatePath("/purchase-orders");
  return { ok: true };
}

export async function rejectPoLine(fd: FormData): Promise<ActionResult> {
  const p = await poApprover();
  if (!p) return { error: "You are not the configured PO approver." };
  const line_id = String(fd.get("line_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!line_id) return { error: "Missing PO line." };
  if (!reason) return { error: "Enter a rejection reason." };
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("reject_po_line", { p_line_id: line_id, p_approver_id: p.id, p_reason: reason });
  if (error) return { error: error.message };
  const res = result as { error?: string };
  if (res?.error) return { error: res.error };
  revalidatePath("/purchase-orders");
  return { ok: true };
}

// ---- document sign-off chain (creator, then any configured approvers) ----
export async function signPo(fd: FormData): Promise<ActionResult & { fully_signed?: boolean }> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const po_id = String(fd.get("document_id") ?? "");
  const signature_id = String(fd.get("signature_id") ?? "");
  if (!po_id || !signature_id) return { error: "Missing document or signature." };
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("sign_po", { p_po_id: po_id, p_signature_id: signature_id, p_actor: p.id });
  if (error) return { error: error.message };
  const res = result as { error?: string; fully_signed?: boolean };
  if (res?.error) return { error: res.error };
  revalidatePath(`/purchase-orders/${po_id}`);
  revalidatePath("/purchase-orders");
  return { ok: true, fully_signed: res.fully_signed };
}

// ---- backfill the creator's signature onto a PO that was already sent before this feature existed — record only, no status effect ----
export async function backfillPoSignature(fd: FormData): Promise<ActionResult & { fully_signed?: boolean }> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const po_id = String(fd.get("document_id") ?? "");
  const signature_id = String(fd.get("signature_id") ?? "");
  if (!po_id || !signature_id) return { error: "Missing document or signature." };
  const supabase = await createClient();
  const { data: result, error } = await supabase.rpc("backfill_signature", {
    p_document_type: "po",
    p_document_id: po_id,
    p_signature_id: signature_id,
    p_actor: p.id,
  });
  if (error) return { error: error.message };
  const res = result as { error?: string; fully_signed?: boolean };
  if (res?.error) return { error: res.error };
  revalidatePath(`/purchase-orders/${po_id}`);
  return { ok: true, fully_signed: res.fully_signed };
}

// ---- raise draft PO(s) for the shortfall components picked on the project's
// Shortfall tab, with the quantity, vendor and rate confirmed in the popup —
// one new draft PO per vendor. Rates go through the usual price gate.
export async function raisePoForSelectedShortfall(fd: FormData): Promise<ActionResult> {
  const p = await procurer();
  if (!p) return { error: "Only Admin / Team Lead can raise POs." };
  const project_id = String(fd.get("project_id") ?? "");
  let items: { component_id: string; qty: number; vendor_id: string | null; rate: number | null }[] = [];
  try {
    items = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    return { error: "Invalid PO details." };
  }
  if (!project_id) return { error: "Missing project." };
  if (items.length === 0) return { error: "Pick at least one component." };
  if (items.some((i) => !i.component_id || !(Number(i.qty) > 0))) return { error: "Every quantity must be more than 0." };
  if (items.some((i) => i.rate != null && !(Number(i.rate) >= 0))) return { error: "Rates can't be negative." };
  if (items.some((i) => !i.vendor_id)) return { error: "Pick a vendor for every component." };

  const supabase = await createClient();
  const { data: consumables } = await supabase
    .from("components").select("component_no").in("id", items.map((i) => i.component_id)).eq("is_consumable", true);
  if (consumables?.length) {
    return { error: `${consumables.map((c) => c.component_no).join(", ")}: consumables aren't ordered per project — take them from consumables stock via requisition.` };
  }
  const byVendor = new Map<string, typeof items>();
  for (const it of items) {
    const group = byVendor.get(it.vendor_id!) ?? [];
    group.push(it);
    byVendor.set(it.vendor_id!, group);
  }
  const { data: vendors } = await supabase.from("vendors").select("id, name").in("id", [...byVendor.keys()]);
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name as string]));

  const created: { id: string; po_no: string; vendor_name: string | null }[] = [];
  for (const [vendorId, lines] of byVendor) {
    // Retried on a unique-number clash: someone else may raise a PO between
    // reading the next number and inserting it.
    let poNo = "";
    let po: { id: string } | null = null;
    for (let attempt = 0; !po; attempt++) {
      poNo = (await supabase.rpc("next_po_no")).data ?? "";
      const { data, error } = await supabase
        .from("purchase_orders")
        .insert({ po_no: poNo, vendor_id: vendorId, status: "draft", source: "system", created_by: p.id })
        .select("id")
        .single();
      if (error && (error.code !== "23505" || attempt >= 4)) return { error: error.message };
      po = data;
    }
    const { error: lErr } = await supabase.from("po_lines").insert(
      lines.map((l) => {
        const qty = Number(l.qty);
        const rate = l.rate == null ? null : Number(l.rate);
        return {
          po_id: po.id,
          component_id: l.component_id,
          project_id,
          qty_ordered: qty,
          rate,
          amount: rate == null ? null : rate * qty,
          created_by: p.id,
        };
      }),
    );
    if (lErr) {
      // Don't leave an empty draft behind when a line is refused (e.g. the BOM rule).
      await supabase.from("purchase_orders").delete().eq("id", po.id);
      return { error: lErr.message };
    }
    await recomputePoTotal(supabase, po.id);
    created.push({ id: po.id, po_no: poNo, vendor_name: vendorName.get(vendorId) ?? null });
  }

  revalidatePath("/purchase-orders");
  revalidatePath(`/projects/${project_id}`);
  if (created.length === 1) return { ok: true, id: created[0].id, created };
  return {
    ok: true,
    created,
    message: `Raised ${created.length} POs — one per vendor: ${created.map((c) => c.vendor_name ?? "—").join(", ")}.`,
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { formatNumber } from "@/lib/utils";

export type ActionResult = { ok?: true; error?: string; id?: string; status?: string };

const RECEIVE = ["admin", "team_lead", "team_member"]; // gate staff can receive

async function receiver() {
  const p = await getProfile();
  return p && RECEIVE.includes(p.role) ? p : null;
}

/** Sign-off chain (creator, then any configured approvers) — required before the GRN/MRIN can be printed. */
export async function signGrn(fd: FormData): Promise<ActionResult & { fully_signed?: boolean }> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const grn_id = String(fd.get("document_id") ?? "");
  const signature_id = String(fd.get("signature_id") ?? "");
  if (!grn_id || !signature_id) return { error: "Missing document or signature." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sign_grn", { p_grn_id: grn_id, p_signature_id: signature_id, p_actor: p.id });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  revalidatePath(`/grn/${grn_id}`);
  return { ok: true, fully_signed: data?.fully_signed };
}

function grnDupeError(error: { message: string; code?: string }, challan_no: string | null, invoice_no: string | null): string {
  if (error.code === "23505") {
    if (error.message.includes("uq_grns_challan_per_vendor")) {
      return `Challan No. "${challan_no}" has already been used for a GRN from this vendor.`;
    }
    if (error.message.includes("uq_grns_invoice_per_vendor")) {
      return `Invoice No. "${invoice_no}" has already been used for a GRN from this vendor.`;
    }
  }
  return error.message;
}

export async function createGrn(fd: FormData): Promise<ActionResult> {
  const p = await receiver();
  if (!p) return { error: "Not authorized to receive goods." };
  const challan_no = String(fd.get("challan_no") ?? "").trim() || null;
  const invoice_no = String(fd.get("invoice_no") ?? "").trim() || null;
  if (!challan_no && !invoice_no) {
    return { error: "Enter a challan number or an invoice number — at least one is required." };
  }
  const vendor_id = String(fd.get("vendor_id") ?? "") || null;

  const supabase = await createClient();

  const { data: grnNo } = await supabase.rpc("next_grn_no");
  const { data, error } = await supabase
    .from("grns")
    .insert({
      grn_no: grnNo,
      vendor_id,
      challan_no,
      invoice_no,
      received_by: p.id,
      created_by: p.id,
    })
    .select("id")
    .single();
  if (error) return { error: grnDupeError(error, challan_no, invoice_no) };

  // Auto-sign the creator's slot right away — a GRN has no draft stage to
  // protect (unlike PO, which still requires an explicit Sign & Send), so
  // there's no reason to make them come back and click Sign separately.
  // Best-effort: if they have no saved signature yet, this
  // silently no-ops and the manual Sign button on the GRN page covers it.
  const { data: mySig } = await supabase
    .from("signatures")
    .select("id")
    .eq("user_id", p.id)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (mySig) {
    await supabase.rpc("sign_grn", { p_grn_id: data.id, p_signature_id: mySig.id, p_actor: p.id });
  }

  if (!invoice_no) {
    await supabase.rpc("notify_grn_missing_invoice", { p_grn_id: data.id, p_user_id: p.id });
  }

  revalidatePath("/grn");
  return { ok: true, id: data.id };
}

export async function addGrnLine(fd: FormData): Promise<ActionResult> {
  const p = await receiver();
  if (!p) return { error: "Not authorized." };
  const grn_id = String(fd.get("grn_id"));
  const component_id = String(fd.get("component_id") ?? "");
  if (!component_id) return { error: "Pick a component." };
  const qty = Number(fd.get("qty_received") ?? 0) || 0;
  if (qty <= 0) return { error: "Enter a received quantity." };
  const unitCostRaw = String(fd.get("unit_cost") ?? "").trim();

  const po_line_id = String(fd.get("po_line_id") ?? "") || null;

  // A PO's price is what gets registered — a typed Unit cost can't coexist with a matched PO.
  if (po_line_id && unitCostRaw !== "") {
    return { error: "A Purchase Order is attached to this line — clear the Unit cost field so the PO's price is the one registered." };
  }

  const pieceCount  = Number(fd.get("piece_count")  ?? "") || null;
  const pieceLength = Number(fd.get("piece_length") ?? "") || null;
  const pieceWidth  = Number(fd.get("piece_width")  ?? "") || null;
  const pieceWeight = Number(fd.get("piece_weight") ?? "") || null;

  const target_lot_id = String(fd.get("target_lot_id") ?? "") || null;
  const mpn_id = String(fd.get("mpn_id") ?? "") || null;

  const supabase = await createClient();

  // Block over-receipt: this line may not push the PO line's total received
  // quantity above what was ordered. Only applies when receiving against a PO
  // line — PO-less receipts have nothing to over-receive against. (DB trigger
  // grn_line_before_insert is the backstop; this gives the receiver a readable
  // message.)
  if (po_line_id) {
    const { data: poLine } = await supabase
      .from("po_lines")
      .select("qty_ordered, qty_received")
      .eq("id", po_line_id)
      .maybeSingle();
    if (poLine) {
      const ordered = Number(poLine.qty_ordered ?? 0);
      const received = Number(poLine.qty_received ?? 0);
      const remaining = ordered - received;
      if (qty > remaining + 1e-6) {
        return {
          error:
            `This PO line has ${formatNumber(remaining)} left to receive ` +
            `(ordered ${formatNumber(ordered)}, already received ${formatNumber(received)}). ` +
            `You entered ${formatNumber(qty)}. Revise the PO quantity if the supplier sent more.`,
        };
      }
    }
  }

  // Trigger: flags untagged, creates inventory lot(s) per tracking_mode (or adds
  // to target_lot_id box), records receipt movement, rolls up PO qty.
  const { data: line, error } = await supabase.from("grn_lines").insert({
    grn_id,
    component_id,
    qty_received: qty,
    po_line_id,
    project_id: String(fd.get("project_id") ?? "") || null,
    unit_cost: unitCostRaw === "" ? null : Number(unitCostRaw),
    target_lot_id,
    mpn_id,
    created_by: p.id,
  }).select("id").single();
  if (error) return { error: error.message };

  // If dimensions were supplied (bulk), patch the lot the trigger just created.
  if (target_lot_id === null && (pieceCount !== null || pieceLength !== null || pieceWidth !== null || pieceWeight !== null)) {
    await supabase
      .from("inventory_lots")
      .update({ piece_count: pieceCount, piece_length: pieceLength, piece_width: pieceWidth, piece_weight: pieceWeight })
      .eq("grn_line_id", line.id);
  }

  revalidatePath(`/grn/${grn_id}`);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";

export type ActionResult = { ok?: true; error?: string };
export type ResolvedLot = {
  id: string;
  lot_code: string;
  component_id: string | null;
  component_label: string;
  qty_on_hand: number;
  location: string | null;
  status: string;
  project_no: string | null;
};

const OPERATE = ["admin", "team_lead", "team_member", "inventory_admin"]; // consume / stock-take
const MANAGE = ["admin", "team_lead", "inventory_admin"]; // transfer (lot update)

async function operator() {
  const p = await getProfile();
  return p && OPERATE.includes(p.role) ? p : null;
}

/** Resolve a scanned/typed lot_code to lot details (for the scan + lot screens). */
export async function resolveLot(lotCode: string): Promise<{ lot?: ResolvedLot; error?: string }> {
  const code = lotCode.trim();
  if (!code) return { error: "Enter or scan a lot code." };
  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("inventory_lots")
    .select("id, lot_code, component_id, qty_on_hand, location, status, project_id")
    .eq("lot_code", code)
    .maybeSingle();
  if (!lot) return { error: `No lot found for "${code}".` };

  const [{ data: comp }, { data: proj }] = await Promise.all([
    lot.component_id ? supabase.from("components").select("component_no, name").eq("id", lot.component_id).maybeSingle() : Promise.resolve({ data: null }),
    lot.project_id ? supabase.from("projects").select("project_no").eq("id", lot.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return {
    lot: {
      id: lot.id,
      lot_code: lot.lot_code,
      component_id: lot.component_id,
      component_label: comp ? `${comp.component_no} — ${comp.name}` : "—",
      qty_on_hand: Number(lot.qty_on_hand ?? 0),
      location: lot.location,
      status: lot.status,
      project_no: proj?.project_no ?? null,
    },
  };
}

async function lotInfo(supabase: Awaited<ReturnType<typeof createClient>>, lotId: string) {
  const { data } = await supabase.from("inventory_lots").select("component_id, qty_on_hand").eq("id", lotId).maybeSingle();
  return data;
}

/** Scan-to-consume: issue qty into a project (or, admin-only, untagged stock with a reason). Writes an `issue` movement; trigger decrements the lot. */
export async function consumeLot(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const lot_id = String(fd.get("lot_id"));
  const qty = Number(fd.get("qty") ?? 0) || 0;
  const project_id = String(fd.get("project_id") ?? "") || null;
  const note = String(fd.get("note") ?? "").trim() || null;
  const requisition_id = String(fd.get("requisition_id") ?? "") || null;
  if (qty <= 0) return { error: "Enter a quantity to consume." };

  if (project_id) {
    if (!OPERATE.includes(p.role)) return { error: "Not authorized." };
  } else {
    // Untagged (stock) consumption — admin-only, and a reason is required (e.g. R&D, sample).
    if (p.role !== "admin") return { error: "Only Admin can consume stock without a project." };
    if (!note) return { error: "Enter a reason (e.g. R&D, sample) for stock consumption." };
  }

  const supabase = await createClient();
  const { data: lotFull } = await supabase
    .from("inventory_lots")
    .select("component_id, qty_on_hand, project_id, status, jw_stage")
    .eq("id", lot_id)
    .maybeSingle();
  if (!lotFull) return { error: "Lot not found." };

  // Raw job-work stock can't be consumed — it must be sent for job work and
  // received back as a completed part first.
  if (lotFull.jw_stage === "raw") {
    return { error: "This is a raw job-work lot — send it for job work and receive the completed part before consuming." };
  }

  // 'issued' lots are exclusively reserved for their project.
  if (lotFull.status === "issued") {
    if (lotFull.project_id !== project_id) {
      return { error: "This lot has been issued to another project and cannot be consumed here." };
    }
  } else if (lotFull.project_id && project_id && lotFull.project_id !== project_id) {
    // 'open' lot that arrived via a project-tagged PO — still reserved for that project.
    return { error: "This lot is reserved for another project and cannot be consumed here." };
  }

  const lot = { component_id: lotFull.component_id, qty_on_hand: lotFull.qty_on_hand };
  if (qty > Number(lot.qty_on_hand ?? 0)) return { error: `Only ${lot.qty_on_hand} on hand.` };

  const { error } = await supabase.from("stock_movements").insert({
    lot_id,
    component_id: lot.component_id,
    movement_type: "issue",
    qty: -qty,
    project_id,
    reference_type: requisition_id ? "requisition" : project_id ? "scan" : "scan-stock",
    reference_id: requisition_id,
    note,
    performed_by: p.id,
    created_by: p.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/inventory/lots/${lot_id}`);
  if (requisition_id) revalidatePath(`/requisitions/${requisition_id}`);
  return { ok: true };
}

/** Stock-take: set the actual on-hand → writes an `adjustment` movement for the difference. */
export async function adjustLot(fd: FormData): Promise<ActionResult> {
  const p = await operator();
  if (!p) return { error: "Not authorized." };
  const lot_id = String(fd.get("lot_id"));
  const actual = Number(fd.get("actual_qty") ?? NaN);
  if (Number.isNaN(actual) || actual < 0) return { error: "Enter the actual counted quantity." };

  const supabase = await createClient();
  const lot = await lotInfo(supabase, lot_id);
  if (!lot) return { error: "Lot not found." };
  const delta = actual - Number(lot.qty_on_hand ?? 0);
  if (delta === 0) return { ok: true };

  const { error } = await supabase.from("stock_movements").insert({
    lot_id,
    component_id: lot.component_id,
    movement_type: "adjustment",
    qty: delta,
    reference_type: "stock-take",
    performed_by: p.id,
    created_by: p.id,
  });
  if (error) return { error: error.message };
  revalidatePath(`/inventory/lots/${lot_id}`);
  return { ok: true };
}

/** Unissue a lot: remove project reservation, return to open (admin/team_lead only). */
export async function unissueLot(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p || !MANAGE.includes(p.role)) return { error: "Only Admin / Team Lead / Inventory Admin can unissue a lot." };
  const lot_id = String(fd.get("lot_id"));
  const component_id = String(fd.get("component_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_lots")
    .update({ status: "open", project_id: null })
    .eq("id", lot_id)
    .eq("status", "issued");
  if (error) return { error: error.message };
  revalidatePath(`/inventory/${component_id}`);
  revalidatePath(`/inventory/lots/${lot_id}`);
  return { ok: true };
}

/**
 * Reverse a specific consumption (`issue`) movement — admin-only. Writes a
 * compensating `return` movement (never mutates the original ledger row);
 * `recompute_lot_on_hand()` picks it up and restores qty_on_hand.
 *
 * A reversal puts the lot back exactly as it was held before the consumption:
 *
 *   - consumed out of **free stock**  -> returns to free stock ('open')
 *   - consumed while **frozen to a project** -> returns to frozen, same project
 *
 * The lot's own `project_id` is what distinguishes the two, and it is reliable:
 * consuming writes a ledger row and never touches the lot's tag, so the tag
 * still says how the lot was held. This function used to *clear* that tag,
 * which destroyed the only record of it — and, because the recompute trigger
 * only flips 'consumed' -> 'open' (it preserves 'issued' on a lot that still
 * has stock), a partly-consumed frozen lot was left marked frozen with no
 * project on it. Nothing could then use that stock, and consuming it failed
 * with a misleading "issued to another project".
 */
export async function reverseConsumption(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p || p.role !== "admin") return { error: "Only Admin can reverse a consumption." };
  const movement_id = String(fd.get("movement_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!movement_id) return { error: "Movement not found." };
  if (!reason) return { error: "Enter a reason for reversing this consumption." };

  const supabase = await createClient();
  const { data: move } = await supabase
    .from("stock_movements")
    .select("id, lot_id, component_id, qty, movement_type, reference_type, project_id")
    .eq("id", movement_id)
    .maybeSingle();
  if (!move) return { error: "Movement not found." };
  if (move.movement_type !== "issue") return { error: "Only a consumption (issue) movement can be reversed." };
  if (move.reference_type === "job_work") {
    return { error: "Job-work dispatches are reversed from the Job Work order's revision flow, not here." };
  }
  if (!move.lot_id) return { error: "This movement has no lot to reverse into." };

  // Read the tag *before* writing the reversal — this is what decides whether
  // the stock goes back to free or back to frozen.
  const { data: lotBefore } = await supabase
    .from("inventory_lots")
    .select("id, project_id")
    .eq("id", move.lot_id)
    .maybeSingle();
  if (!lotBefore) return { error: "Lot not found." };

  const { data: existingReversal } = await supabase
    .from("stock_movements")
    .select("id")
    .eq("reference_type", "consumption_reversal")
    .eq("reference_id", movement_id)
    .maybeSingle();
  if (existingReversal) return { error: "This consumption has already been reversed." };

  const { error: insErr } = await supabase.from("stock_movements").insert({
    lot_id: move.lot_id,
    component_id: move.component_id,
    movement_type: "return",
    qty: Math.abs(Number(move.qty)),
    project_id: move.project_id,
    reference_type: "consumption_reversal",
    reference_id: movement_id,
    note: reason,
    performed_by: p.id,
    created_by: p.id,
  });
  if (insErr) return { error: insErr.message };

  // The lot keeps its project tag either way — it is the record of how the
  // stock was held. Only the status needs restoring, and only for a frozen lot:
  // the trigger has just flipped it to 'open' if the lot had been emptied, so
  // put it back to 'issued'. Guarded on qty_on_hand > 0 because reversing one
  // of several consumptions can leave the lot still empty, and an empty lot
  // must stay 'consumed'. A lot with no tag was free stock and the trigger has
  // already landed it correctly.
  if (lotBefore.project_id) {
    const { error: statusErr } = await supabase
      .from("inventory_lots")
      .update({ status: "issued" })
      .eq("id", move.lot_id)
      .gt("qty_on_hand", 0);
    if (statusErr) return { error: `Stock returned, but re-freezing the lot failed: ${statusErr.message}` };
  }

  revalidatePath(`/inventory/lots/${move.lot_id}`);
  if (move.component_id) revalidatePath(`/inventory/${move.component_id}`);
  if (move.project_id) revalidatePath(`/projects/${move.project_id}`);
  return { ok: true };
}

/** Transfer a lot to a new location (admin/team_lead — updates the lot). */
export async function transferLot(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p || !MANAGE.includes(p.role)) return { error: "Only Admin / Team Lead / Inventory Admin can transfer." };
  const lot_id = String(fd.get("lot_id"));
  const location = String(fd.get("location") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_lots").update({ location }).eq("id", lot_id);
  if (error) return { error: error.message };
  await supabase.from("stock_movements").insert({
    lot_id,
    component_id: (await lotInfo(supabase, lot_id))?.component_id,
    movement_type: "transfer",
    qty: 0,
    reference_type: "transfer",
    performed_by: p.id,
    created_by: p.id,
  });
  revalidatePath(`/inventory/lots/${lot_id}`);
  return { ok: true };
}

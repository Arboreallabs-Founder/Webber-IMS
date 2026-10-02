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
  /** The box this lot physically sits in — itself, unless it's a reserved slice. */
  box_lot_code: string;
  /** Reserved inside this box for the scanning project (0 when no project). */
  reserved_qty: number;
  /** Free stock in this box usable by the scanning project. */
  open_qty: number;
  /** reserved_qty + open_qty — the most one scan of this box can consume. */
  available_qty: number;
  /** Reserved inside this box for other projects — never consumable here. */
  reserved_elsewhere: { project_no: string; qty: number }[];
  is_raw_job_work: boolean;
};

const OPERATE = ["admin", "team_lead", "team_member", "inventory_admin"]; // consume / stock-take
const MANAGE = ["admin", "team_lead", "inventory_admin"]; // transfer (lot update)

async function operator() {
  const p = await getProfile();
  return p && OPERATE.includes(p.role) ? p : null;
}

/**
 * Resolve a scanned/typed lot_code for the scan screen. The floor only ever
 * scans the box sticker, so this reads the whole box — its own open stock
 * plus every reserved slice inside it — and splits it the same way
 * `consume_from_lot` will: reserved for `projectId`, open, and reserved for
 * someone else.
 */
export async function resolveLot(lotCode: string, projectId?: string | null): Promise<{ lot?: ResolvedLot; error?: string }> {
  const code = lotCode.trim();
  if (!code) return { error: "Enter or scan a lot code." };
  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("inventory_lots")
    .select("id, lot_code, component_id, qty_on_hand, location, status, project_id, source_lot_id")
    .eq("lot_code", code)
    .maybeSingle();
  if (!lot) return { error: `No lot found for "${code}".` };

  const boxId = lot.source_lot_id ?? lot.id;
  const { data: group } = await supabase
    .from("inventory_lots")
    .select("id, lot_code, qty_on_hand, status, project_id, jw_stage")
    .or(`id.eq.${boxId},source_lot_id.eq.${boxId}`);
  const members = (group ?? []).filter((m) => Number(m.qty_on_hand ?? 0) > 0);
  const box = (group ?? []).find((m) => m.id === boxId);

  let reserved = 0;
  let open = 0;
  const elsewhere = new Map<string, number>();
  for (const m of members) {
    const q = Number(m.qty_on_hand ?? 0);
    if (m.status === "issued" && projectId && m.project_id === projectId) reserved += q;
    else if (m.status === "open" && (!m.project_id || !projectId || m.project_id === projectId)) open += q;
    else if (m.status === "issued" && m.project_id) elsewhere.set(m.project_id, (elsewhere.get(m.project_id) ?? 0) + q);
  }

  const projectIds = [...new Set([lot.project_id, ...elsewhere.keys()].filter(Boolean))] as string[];
  const [{ data: comp }, { data: projs }] = await Promise.all([
    lot.component_id ? supabase.from("components").select("component_no, name").eq("id", lot.component_id).maybeSingle() : Promise.resolve({ data: null }),
    projectIds.length ? supabase.from("projects").select("id, project_no").in("id", projectIds) : Promise.resolve({ data: [] }),
  ]);
  const projNo = new Map((projs ?? []).map((p) => [p.id, p.project_no]));

  return {
    lot: {
      id: lot.id,
      lot_code: lot.lot_code,
      component_id: lot.component_id,
      component_label: comp ? `${comp.component_no} — ${comp.name}` : "—",
      qty_on_hand: Number(lot.qty_on_hand ?? 0),
      location: lot.location,
      status: lot.status,
      project_no: lot.project_id ? projNo.get(lot.project_id) ?? null : null,
      box_lot_code: box?.lot_code ?? lot.lot_code,
      reserved_qty: reserved,
      open_qty: open,
      available_qty: reserved + open,
      reserved_elsewhere: [...elsewhere.entries()].map(([pid, qty]) => ({ project_no: projNo.get(pid) ?? "—", qty })),
      is_raw_job_work: box?.jw_stage === "raw",
    },
  };
}

async function lotInfo(supabase: Awaited<ReturnType<typeof createClient>>, lotId: string) {
  const { data } = await supabase.from("inventory_lots").select("component_id, qty_on_hand").eq("id", lotId).maybeSingle();
  return data;
}

export type ConsumeResult = ActionResult & { fromReserved?: number; fromOpen?: number; released?: number };

/**
 * Scan-to-consume: issue qty into a project (or, admin-only, untagged stock
 * with a reason). All the rules live in `consume_from_lot`: it draws this
 * project's reservation inside the scanned box first, then the box's open
 * stock, never another project's; mirrors it into the MPN breakdown; and
 * then frees anything the project no longer needs back into its box.
 */
export async function consumeLot(fd: FormData): Promise<ConsumeResult> {
  const p = await getProfile();
  if (!p) return { error: "Not authorized." };
  const lot_id = String(fd.get("lot_id"));
  const qty = Number(fd.get("qty") ?? 0) || 0;
  const project_id = String(fd.get("project_id") ?? "") || null;
  const note = String(fd.get("note") ?? "").trim() || null;
  const requisition_id = String(fd.get("requisition_id") ?? "") || null;
  if (qty <= 0) return { error: "Enter a quantity to consume." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_from_lot", {
    p_lot: lot_id,
    p_qty: qty,
    p_project: project_id ?? undefined,
    p_requisition: requisition_id ?? undefined,
    p_note: note ?? undefined,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { from_reserved?: number; from_open?: number; released?: number };

  revalidatePath(`/inventory/lots/${lot_id}`);
  if (requisition_id) revalidatePath(`/requisitions/${requisition_id}`);
  if (project_id) revalidatePath(`/projects/${project_id}`);
  return {
    ok: true,
    fromReserved: Number(res.from_reserved ?? 0),
    fromOpen: Number(res.from_open ?? 0),
    released: Number(res.released ?? 0),
  };
}

/**
 * Stock-take: set the actual on-hand → writes an `adjustment` movement for
 * the difference. The count is of the whole physical box, so it's compared
 * against the box's own stock + everything reserved inside it; the
 * difference lands on the box's own (open) stock. A reserved slice has no
 * sticker of its own and is counted through its box.
 */
export async function adjustLot(fd: FormData): Promise<ActionResult> {
  const p = await operator();
  if (!p) return { error: "Not authorized." };
  const lot_id = String(fd.get("lot_id"));
  const actual = Number(fd.get("actual_qty") ?? NaN);
  if (Number.isNaN(actual) || actual < 0) return { error: "Enter the actual counted quantity." };

  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("inventory_lots")
    .select("component_id, qty_on_hand, source_lot_id")
    .eq("id", lot_id)
    .maybeSingle();
  if (!lot) return { error: "Lot not found." };
  if (lot.source_lot_id) return { error: "This is a reserved part of a box — do the stock-take on the box itself." };

  const { data: slices } = await supabase
    .from("inventory_lots")
    .select("qty_on_hand")
    .eq("source_lot_id", lot_id)
    .gt("qty_on_hand", 0);
  const insideReserved = (slices ?? []).reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
  const ownQty = Number(lot.qty_on_hand ?? 0);
  const delta = actual - (ownQty + insideReserved);
  if (delta === 0) return { ok: true };
  if (ownQty + delta < 0) {
    return {
      error: `Counted ${actual}, but ${insideReserved} in this box is reserved for projects. If reserved stock is really missing, unissue it first.`,
    };
  }

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

/**
 * Unissue all or part of a reserved lot (admin / team lead / inventory admin).
 * A reserved slice goes back into the box it sits in; a whole reserved lot
 * goes open (a partial unissue keeps the still-reserved part as a slice inside
 * it, so the sticker always points at free stock).
 */
export async function unissueLot(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!p || !MANAGE.includes(p.role)) return { error: "Only Admin / Team Lead / Inventory Admin can unissue a lot." };
  const lot_id = String(fd.get("lot_id"));
  const component_id = String(fd.get("component_id") ?? "");
  const rawQty = String(fd.get("qty") ?? "").trim();
  const qty = rawQty ? Number(rawQty) : null;
  if (qty !== null && (Number.isNaN(qty) || qty <= 0)) return { error: "Enter a quantity to unissue, or leave it blank for all." };

  const supabase = await createClient();
  const { data: lot } = await supabase.from("inventory_lots").select("source_lot_id").eq("id", lot_id).maybeSingle();
  const { error } = await supabase.rpc("release_blocked_lot", { p_lot: lot_id, p_qty: qty ?? undefined });
  if (error) return { error: error.message };
  revalidatePath(`/inventory/${component_id}`);
  revalidatePath(`/inventory/lots/${lot_id}`);
  if (lot?.source_lot_id) revalidatePath(`/inventory/lots/${lot.source_lot_id}`);
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
  const { data: lot } = await supabase.from("inventory_lots").select("source_lot_id").eq("id", lot_id).maybeSingle();
  if (lot?.source_lot_id) return { error: "This is a reserved part of a box — transfer the box itself." };
  // Reserved parts physically sit in the box, so they move with it.
  const { error } = await supabase.from("inventory_lots").update({ location }).or(`id.eq.${lot_id},source_lot_id.eq.${lot_id}`);
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

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";
import { expandBomLines, type TemplateLine } from "@/lib/bom-engine";

export type ActionResult = { ok?: true; error?: string; message?: string; id?: string };

async function planner() {
  const profile = await getProfile();
  return canWriteMasters(profile?.role) ? profile : null; // admin or team_lead
}

function revalidate(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
}

// ---------- project status ----------
export async function updateProjectStatus(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const project_id = String(fd.get("project_id") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!project_id || !status) return { error: "Missing fields." };
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ status }).eq("id", project_id);
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

// ---------- block stock for the approved BOM ----------
// Creates a requisition from the approved BOM's lines and reserves ("blocks")
// whatever's currently on hand for it (best-effort — see issue_requisition).
export async function blockStockForBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Only Admin / Team Lead can block stock." };
  const project_id = String(fd.get("project_id") ?? "");
  const bom_id = String(fd.get("bom_id") ?? "");
  if (!project_id || !bom_id) return { error: "Missing project/BOM." };
  const supabase = await createClient();

  const { data: bom } = await supabase.from("boms").select("status").eq("id", bom_id).maybeSingle();
  if (!bom || bom.status !== "approved") return { error: "Approve the BOM before blocking stock." };

  const { data: lines } = await supabase.from("bom_lines").select("component_id, required_qty").eq("bom_id", bom_id);
  if (!lines || lines.length === 0) return { error: "BOM has no lines." };

  const byComponent = new Map<string, number>();
  for (const l of lines) {
    if (!l.component_id) continue;
    byComponent.set(l.component_id, (byComponent.get(l.component_id) ?? 0) + Number(l.required_qty ?? 0));
  }
  if (byComponent.size === 0) return { error: "BOM has no component lines to block stock for." };

  // Only reserve what's still to be used: once work has started, what's
  // already been consumed must not be reserved a second time.
  // (issue_requisition separately nets off what's already reserved.)
  const { data: consumed } = await supabase
    .from("v_project_consumption")
    .select("component_id, consumed_qty")
    .eq("project_id", project_id);
  for (const c of consumed ?? []) {
    if (!c.component_id || !byComponent.has(c.component_id)) continue;
    const left = (byComponent.get(c.component_id) ?? 0) - Number(c.consumed_qty ?? 0);
    if (left > 0) byComponent.set(c.component_id, left);
    else byComponent.delete(c.component_id);
  }
  for (const [cid, qty] of byComponent) if (qty <= 0) byComponent.delete(cid);
  if (byComponent.size === 0) return { error: "Everything in the BOM has already been consumed — nothing left to block." };

  const { data: reqNo } = await supabase.rpc("next_req_no");
  const { data: req, error: reqErr } = await supabase
    .from("requisitions")
    .insert({ req_no: reqNo, project_id, status: "open", requested_by: p.id, created_by: p.id })
    .select("id")
    .single();
  if (reqErr || !req) return { error: reqErr?.message ?? "Could not create requisition." };

  const reqLines = [...byComponent.entries()].map(([component_id, qty]) => ({
    requisition_id: req.id,
    component_id,
    qty,
    created_by: p.id,
  }));
  const { error: lErr } = await supabase.from("requisition_lines").insert(reqLines);
  if (lErr) return { error: lErr.message };

  const { data: result, error: issueErr } = await supabase.rpc("issue_requisition", {
    p_req_id: req.id,
    p_user_id: p.id,
  });
  if (issueErr) return { error: issueErr.message };
  if ((result as { error?: string })?.error) return { error: (result as { error?: string }).error };

  revalidate(project_id);
  const short = (result as { short?: { label: string; short_qty: number }[] })?.short ?? [];
  const message = short.length
    ? `Blocked what's available for ${byComponent.size} component(s). Still short: ${short.map((s) => `${s.label} (${s.short_qty})`).join(", ")}.`
    : `Blocked all required stock for ${byComponent.size} component(s).`;
  return { ok: true, id: req.id, message };
}

// ---------- line items ----------
export async function addLineItem(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Only Admin / Team Lead can edit orders." };
  const project_id = String(fd.get("project_id") ?? "");
  const product_id = String(fd.get("product_id") ?? "");
  if (!project_id || !product_id) return { error: "Pick a product." };
  let variant_selections: unknown = {};
  try {
    variant_selections = JSON.parse(String(fd.get("variant_selections") ?? "{}"));
  } catch {
    variant_selections = {};
  }
  const quantity = Math.max(1, Number(fd.get("quantity") ?? 1) || 1);
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_line_items")
    .insert({ project_id, product_id, variant_selections, quantity, created_by: p.id });
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

export async function removeLineItem(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("project_line_items").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

// ---------- variant → BOM engine ----------
export async function generateBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Only Admin / Team Lead can generate a BOM." };
  const project_id = String(fd.get("project_id") ?? "");
  if (!project_id) return { error: "Missing project." };
  const supabase = await createClient();

  // 1) line items
  const { data: items } = await supabase
    .from("project_line_items")
    .select("id, product_id, variant_selections, quantity")
    .eq("project_id", project_id);
  if (!items || items.length === 0) return { error: "Add at least one line item first." };

  // 2) ensure a BOM exists (reset to draft on regenerate)
  const { data: existingBom } = await supabase
    .from("boms")
    .select("id, status")
    .eq("project_id", project_id)
    .maybeSingle();
  let bomId = existingBom?.id as string | undefined;
  if (!bomId) {
    const { data: bom, error } = await supabase
      .from("boms")
      .insert({ project_id, status: "draft", created_by: p.id })
      .select("id")
      .single();
    if (error) return { error: error.message };
    bomId = bom.id;
  } else if (existingBom?.status === "approved") {
    await supabase.from("boms").update({ status: "draft", approved_by: null, approved_at: null }).eq("id", bomId);
  }

  // 3) clear previous template-sourced lines (keep manual)
  await supabase.from("bom_lines").delete().eq("bom_id", bomId).eq("source", "template");

  // 4) lookups: active templates + their lines + component_no map
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  const [{ data: templates }, { data: components }] = await Promise.all([
    supabase.from("bom_templates").select("id, product_id").eq("is_active", true).in("product_id", productIds),
    supabase.from("components").select("id, component_no"),
  ]);
  const templateByProduct = new Map((templates ?? []).map((t) => [t.product_id, t.id]));
  const compByNo = new Map((components ?? []).map((c) => [String(c.component_no).toLowerCase(), c.id]));

  const templateIds = [...new Set([...templateByProduct.values()])];
  const linesByTemplate = new Map<string, TemplateLine[]>();
  if (templateIds.length) {
    const { data: tlines } = await supabase
      .from("bom_template_lines")
      .select("*")
      .in("bom_template_id", templateIds);
    for (const tl of tlines ?? []) {
      const k = tl.bom_template_id as string;
      if (!linesByTemplate.has(k)) linesByTemplate.set(k, []);
      linesByTemplate.get(k)!.push({
        component_id: tl.component_id,
        quantity: tl.quantity,
        is_variant_driven: tl.is_variant_driven,
        variant_rule: tl.variant_rule,
      });
    }
  }

  // 5) expand (pure logic)
  const { lines: expanded, skippedNoTemplate, skippedNoMatch } = expandBomLines({
    items: items.map((i) => ({
      id: i.id,
      product_id: i.product_id,
      variant_selections: (i.variant_selections ?? {}) as Record<string, unknown>,
      quantity: i.quantity,
    })),
    templateByProduct,
    linesByTemplate,
    compByNo,
  });

  const newLines = expanded.map((l) => ({ ...l, bom_id: bomId, source: "template", created_by: p.id }));
  if (newLines.length) {
    const { error } = await supabase.from("bom_lines").insert(newLines);
    if (error) return { error: error.message };
  }

  revalidate(project_id);
  const notes: string[] = [`Generated ${newLines.length} BOM line(s).`];
  if (skippedNoTemplate) notes.push(`${skippedNoTemplate} line item(s) had no active BOM template.`);
  if (skippedNoMatch) notes.push(`${skippedNoMatch} variant-driven line(s) had no matching rule for the selected variant.`);
  return { ok: true, message: notes.join(" ") };
}

// ---------- custom (template-free) BOM ----------
export async function startCustomBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Only Admin / Team Lead can start a BOM." };
  const project_id = String(fd.get("project_id") ?? "");
  if (!project_id) return { error: "Missing project." };
  const supabase = await createClient();

  const { data: existing } = await supabase.from("boms").select("id").eq("project_id", project_id).maybeSingle();
  if (existing) return { error: "A BOM already exists for this project." };

  const { error } = await supabase.from("boms").insert({ project_id, status: "draft", created_by: p.id });
  if (error) return { error: error.message };

  revalidate(project_id);
  return { ok: true, message: "Custom BOM started — add line items below." };
}

// ---------- BOM approval + manual lines ----------
export async function approveBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Only Admin / Team Lead can approve." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("boms")
    .update({ status: "approved", approved_by: p.id, approved_at: new Date().toISOString() })
    .eq("id", bom_id);
  if (error) return { error: error.message };

  // The approved BOM is part of what each component "still needs" — free any
  // stock now reserved beyond that straight away rather than at the next scan.
  const { data: recheck, error: recheckErr } = await supabase.rpc("recheck_project_reservations", { p_project: project_id });
  revalidate(project_id);
  if (recheckErr) return { ok: true, message: `BOM approved, but re-checking reserved stock failed: ${recheckErr.message}` };
  const released = Number((recheck as { released?: number } | null)?.released ?? 0);
  return released > 0
    ? { ok: true, message: `BOM approved. ${released} reserved beyond what the BOM needs went back to open stock.` }
    : { ok: true };
}

export async function unapproveBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase
    .from("boms")
    .update({ status: "draft", approved_by: null, approved_at: null })
    .eq("id", bom_id);
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

export async function addManualBomLine(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const component_id = String(fd.get("component_id") ?? "");
  const required_qty = Number(fd.get("required_qty") ?? 0) || 0;
  if (!component_id) return { error: "Pick a component." };
  const supabase = await createClient();
  const { error } = await supabase.from("bom_lines").insert({
    bom_id,
    component_id,
    required_qty,
    source: "manual",
    note: String(fd.get("note") ?? "").trim() || null,
    created_by: p.id,
  });
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

export async function removeBomLine(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const id = String(fd.get("id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("bom_lines").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

// ---------- shortfall panel: "Replace with in-stock alternative" ----------
// Shifts demand from a short component onto an approved alternative that
// currently has free stock: a negative adjustment against the original (only
// as much as the alternative can actually cover) and a matching positive one
// against the alternative. Both numbers are re-derived here from the live
// shortfall/on-hand figures — never trust whatever the client last rendered,
// since stock can move between page load and click.
//
// The pair is found by substitution_alt_id (each row points at the other
// component in the swap) and updated in place rather than re-inserted, so
// clicking again — after stock shifts, or just a duplicate click — recomputes
// the same pair instead of stacking up duplicate lines.
export async function replaceShortfallWithAlternative(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const project_id = String(fd.get("project_id") ?? "");
  const bom_id = String(fd.get("bom_id") ?? "");
  const component_id = String(fd.get("component_id") ?? "");
  const alternative_id = String(fd.get("alternative_id") ?? "");
  if (!project_id || !bom_id || !component_id || !alternative_id) return { error: "Missing fields." };

  const supabase = await createClient();

  const { data: shortfallRow } = await supabase
    .from("v_project_shortfall")
    .select("shortfall_qty")
    .eq("project_id", project_id)
    .eq("component_id", component_id)
    .maybeSingle();
  const shortfallQty = Number(shortfallRow?.shortfall_qty ?? 0);
  if (shortfallQty <= 0) return { error: "This component is no longer short — nothing to replace." };

  // Free stock for the alternative: general/untagged lots, plus this
  // project's own — same definition the shortfall panel's own figures use.
  const { data: altLots } = await supabase
    .from("inventory_lots")
    .select("qty_on_hand, project_id")
    .eq("component_id", alternative_id)
    .neq("status", "consumed")
    .gt("qty_on_hand", 0);
  const altOnHand = (altLots ?? [])
    .filter((l) => l.project_id === null || l.project_id === project_id)
    .reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);

  const swapQty = Math.min(shortfallQty, altOnHand);
  if (swapQty <= 0) return { error: "The alternative has no free stock to substitute." };

  const { data: comps } = await supabase.from("components").select("id, component_no").in("id", [component_id, alternative_id]);
  const compNo = new Map((comps ?? []).map((c) => [c.id, c.component_no]));

  const { data: existingCredit } = await supabase
    .from("bom_lines")
    .select("id")
    .eq("bom_id", bom_id).eq("component_id", component_id).eq("substitution_alt_id", alternative_id)
    .maybeSingle();
  const { data: existingDemand } = await supabase
    .from("bom_lines")
    .select("id")
    .eq("bom_id", bom_id).eq("component_id", alternative_id).eq("substitution_alt_id", component_id)
    .maybeSingle();

  const creditNote = `Replaced by ${compNo.get(alternative_id) ?? "alternative"} (in-stock alternative)`;
  const demandNote = `Substitute for ${compNo.get(component_id) ?? "original"} (in-stock alternative)`;

  if (existingCredit) {
    const { error } = await supabase.from("bom_lines").update({ required_qty: -swapQty, note: creditNote }).eq("id", existingCredit.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("bom_lines").insert({
      bom_id, component_id, required_qty: -swapQty, source: "manual",
      substitution_alt_id: alternative_id, note: creditNote, created_by: p.id,
    });
    if (error) return { error: error.message };
  }

  if (existingDemand) {
    const { error } = await supabase.from("bom_lines").update({ required_qty: swapQty, note: demandNote }).eq("id", existingDemand.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("bom_lines").insert({
      bom_id, component_id: alternative_id, required_qty: swapQty, source: "manual",
      substitution_alt_id: component_id, note: demandNote, created_by: p.id,
    });
    if (error) return { error: error.message };
  }

  revalidate(project_id);
  return { ok: true, message: `Replaced ${swapQty} unit(s) with ${compNo.get(alternative_id) ?? "the alternative"}.` };
}

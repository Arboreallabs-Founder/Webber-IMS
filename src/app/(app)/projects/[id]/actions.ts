"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canApproveBom, canManageUsers } from "@/lib/auth";
import { expandBomLines, type TemplateLine } from "@/lib/bom-engine";
import { readAll } from "@/lib/server/read-all";

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

// ---------- does this project need a BOM? ----------
// New projects need an approved BOM before POs, blocking or consumption (the
// database enforces it). A full Admin can tick "No BOM needed" — consumables,
// fixed assets and other internal projects — or untick it again.
export async function setBomNotNeeded(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!canManageUsers(p)) return { error: "Only an Admin can change whether a project needs a BOM." };
  const project_id = String(fd.get("project_id") ?? "");
  if (!project_id) return { error: "Missing project." };
  const notNeeded = fd.get("not_needed") === "true";
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ bom_not_needed: notNeeded }).eq("id", project_id);
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

  // Only block what the project hasn't already consumed — otherwise a BOM
  // approved after work started would reserve its full quantity again.
  // (issue_requisition separately subtracts what is already reserved.)
  const { data: consumption } = await supabase
    .from("v_project_consumption")
    .select("component_id, consumed_qty")
    .eq("project_id", project_id);
  for (const c of consumption ?? []) {
    if (!c.component_id || !byComponent.has(c.component_id)) continue;
    const left = byComponent.get(c.component_id)! - Number(c.consumed_qty ?? 0);
    if (left > 0) byComponent.set(c.component_id, left);
    else byComponent.delete(c.component_id);
  }
  // Raw material out with a job-work vendor for this project isn't consumption,
  // but it is already spoken for — don't block more stock in its place.
  const { data: jwOut } = await supabase
    .from("job_work_orders")
    .select("job_work_lines(component_id, qty_sent, qty_returned)")
    .eq("project_id", project_id)
    .in("status", ["sent", "partial"]);
  for (const l of (jwOut ?? []).flatMap((o) => o.job_work_lines ?? [])) {
    if (!l.component_id || !byComponent.has(l.component_id)) continue;
    const left = byComponent.get(l.component_id)! - Math.max(Number(l.qty_sent ?? 0) - Number(l.qty_returned ?? 0), 0);
    if (left > 0) byComponent.set(l.component_id, left);
    else byComponent.delete(l.component_id);
  }
  if (byComponent.size === 0) return { ok: true, message: "Nothing to block — the project has already consumed everything on the BOM." };

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
  } else if (existingBom?.status !== "draft") {
    // Regenerating an approved or submitted BOM sends it back to draft — it needs approving again.
    await supabase.from("boms").update(BACK_TO_DRAFT).eq("id", bomId);
  }

  // 3) clear previous template-sourced lines (keep manual)
  await supabase.from("bom_lines").delete().eq("bom_id", bomId).eq("source", "template");

  // 4) lookups: active templates + their lines + component_no map
  const productIds = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  const [{ data: templates }, components] = await Promise.all([
    supabase.from("bom_templates").select("id, product_id").eq("is_active", true).in("product_id", productIds),
    readAll((f, t) => supabase.from("components").select("id, component_no").order("id").range(f, t)),
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
// Draft -> (Submit) -> Waiting for approval -> (Approve) -> Approved.
// An Admin or Team Lead can approve straight from draft. A Factory Admin can
// only submit; the boms_guard_approval trigger refuses an approval from them.
const BACK_TO_DRAFT = {
  status: "draft" as const,
  approved_by: null,
  approved_at: null,
  submitted_by: null,
  submitted_at: null,
};

async function bomState(supabase: Awaited<ReturnType<typeof createClient>>, bom_id: string) {
  const { data } = await supabase.from("boms").select("id, status, project_id, submitted_by").eq("id", bom_id).maybeSingle();
  return data;
}

/** Tell people in the app (and on their phones) about a BOM step. */
async function notify(
  supabase: Awaited<ReturnType<typeof createClient>>,
  type: string,
  project_id: string,
  recipients: string[],
  message: (projectNo: string) => string,
  actorId: string,
) {
  const to = [...new Set(recipients)].filter((r) => r && r !== actorId);
  if (to.length === 0) return;
  const { data: project } = await supabase.from("projects").select("project_no").eq("id", project_id).maybeSingle();
  const text = message(project?.project_no ?? "a project");
  await supabase.from("notifications").insert(
    to.map((recipient_id) => ({ type, project_id, message: text, link_path: `/projects/${project_id}#bom`, created_by: actorId, recipient_id })),
  );
}

export async function submitBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const bom = await bomState(supabase, bom_id);
  if (!bom) return { error: "BOM not found." };
  if (bom.status !== "draft") return { error: "Only a draft BOM can be submitted." };
  const { count } = await supabase.from("bom_lines").select("id", { count: "exact", head: true }).eq("bom_id", bom_id);
  if (!count) return { error: "Add at least one line before submitting." };

  const { error } = await supabase
    .from("boms")
    .update({ status: "pending_approval", submitted_by: p.id, submitted_at: new Date().toISOString(), review_note: null })
    .eq("id", bom_id)
    .eq("status", "draft");
  if (error) return { error: error.message };

  const { data: approvers } = await supabase
    .from("profiles")
    .select("id")
    .in("role", ["admin", "team_lead"])
    .eq("is_factory_admin", false)
    .eq("is_active", true);
  await notify(supabase, "bom_submitted", project_id, (approvers ?? []).map((a) => a.id),
    (no) => `${p.full_name ?? "Someone"} submitted the BOM for ${no} for approval.`, p.id);

  revalidate(project_id);
  return { ok: true, message: "Submitted for approval. An Admin will review it." };
}

export async function withdrawBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("boms").update(BACK_TO_DRAFT).eq("id", bom_id).eq("status", "pending_approval");
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

export async function sendBackBom(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!canApproveBom(p)) return { error: "Only an Admin or Team Lead can send a BOM back." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { error: "Say what needs changing." };
  const supabase = await createClient();
  const bom = await bomState(supabase, bom_id);
  if (!bom || bom.status !== "pending_approval") return { error: "This BOM isn't waiting for approval." };

  const { error } = await supabase.from("boms").update({ ...BACK_TO_DRAFT, review_note: reason }).eq("id", bom_id);
  if (error) return { error: error.message };
  if (bom.submitted_by) {
    await notify(supabase, "bom_sent_back", project_id, [bom.submitted_by],
      (no) => `${p!.full_name ?? "An Admin"} sent the BOM for ${no} back: ${reason}`, p!.id);
  }
  revalidate(project_id);
  return { ok: true };
}

export async function approveBom(fd: FormData): Promise<ActionResult> {
  const p = await getProfile();
  if (!canApproveBom(p)) return { error: "Only an Admin or Team Lead can approve a BOM — submit it for approval instead." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const bom = await bomState(supabase, bom_id);
  if (!bom) return { error: "BOM not found." };
  if (bom.status === "approved") return { error: "This BOM is already approved." };
  const { error } = await supabase
    .from("boms")
    .update({ status: "approved", approved_by: p!.id, approved_at: new Date().toISOString(), review_note: null })
    .eq("id", bom_id);
  if (error) return { error: error.message };
  if (bom.submitted_by) {
    await notify(supabase, "bom_approved", project_id, [bom.submitted_by],
      (no) => `${p!.full_name ?? "An Admin"} approved the BOM for ${no}.`, p!.id);
  }

  // The requirement may have just changed — free any reservation the project
  // no longer needs rather than waiting for its next consumption.
  const { data: recheck, error: recheckErr } = await supabase.rpc("recheck_project_reservations", { p_project_id: project_id });
  revalidate(project_id);
  const res = recheck as { error?: string; released?: number } | null;
  if (recheckErr || res?.error) {
    return { ok: true, message: `BOM approved, but checking reserved stock failed: ${recheckErr?.message ?? res?.error}` };
  }
  const released = Number(res?.released ?? 0);
  return released > 0
    ? { ok: true, message: `BOM approved. ${released} reserved for this project was no longer needed and went back to open inventory.` }
    : { ok: true };
}

/** "Unapprove" for an approver, "Edit BOM" for a Factory Admin — back to draft either way. */
export async function unapproveBom(fd: FormData): Promise<ActionResult> {
  const p = await planner();
  if (!p) return { error: "Not authorized." };
  const bom_id = String(fd.get("bom_id") ?? "");
  const project_id = String(fd.get("project_id") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("boms").update(BACK_TO_DRAFT).eq("id", bom_id).eq("status", "approved");
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

/** Lines can only change while the BOM is a draft. */
async function draftBomOrError(supabase: Awaited<ReturnType<typeof createClient>>, bom_id: string) {
  const bom = await bomState(supabase, bom_id);
  if (!bom) return "BOM not found.";
  if (bom.status === "approved") return "This BOM is approved — edit it first.";
  if (bom.status === "pending_approval") return "This BOM is waiting for approval — withdraw it first.";
  return null;
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
  const locked = await draftBomOrError(supabase, bom_id);
  if (locked) return { error: locked };
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
  const { data: line } = await supabase.from("bom_lines").select("bom_id").eq("id", id).maybeSingle();
  if (!line) return { error: "Line not found." };
  const locked = await draftBomOrError(supabase, line.bom_id);
  if (locked) return { error: locked };
  const { error } = await supabase.from("bom_lines").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidate(project_id);
  return { ok: true };
}

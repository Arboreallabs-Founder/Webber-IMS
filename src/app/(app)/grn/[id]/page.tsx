import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DocumentSignButton, type MySignature } from "@/components/document-sign-button";
import { getSigningState } from "@/lib/signatures";
import { formatDate } from "@/lib/utils";
import { GrnReceiver } from "./grn-receiver";
import { JwGrnReceiver, type OpenJwLine, type PostedJwLine, type PendingJwIrn, type TemplateField } from "./jw-grn-receiver";
import { submitIrn } from "../irn-actions";
import { signGrn } from "../actions";
import { readAll } from "@/lib/server/read-all";

export default async function GrnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const role = profile?.role;
  const canReceive = role === "admin" || role === "team_lead" || role === "team_member" || role === "floor";
  const supabase = await createClient();

  const { data: grn } = await supabase.from("grns").select("*").eq("id", id).single();
  if (!grn) notFound();

  const [signingState, { data: mySignatures }] = await Promise.all([
    getSigningState("grn", id, grn.created_by, profile?.id ?? null, grn.created_at),
    profile ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", profile.id).order("is_default", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);

  if (grn.is_job_work) {
    return (
      <JobWorkGrnPage
        grnId={id}
        grn={grn}
        canReceive={canReceive}
        canSeeFinancials={canSeeFinancials(role)}
        signingState={signingState}
        mySignatures={mySignatures ?? []}
      />
    );
  }

  const [{ data: grnLines }, components, { data: projects }, vendor, { data: allOpenPoLines }, { data: vendorComps }] =
    await Promise.all([
      supabase.from("grn_lines").select("*").eq("grn_id", id).order("created_at"),
      readAll((f, t) => supabase.from("components").select("id, component_no, name, quantity_type, tracking_mode, inspection_template_id").order("component_no").order("id").range(f, t)),
      supabase.from("projects").select("id, project_no").order("project_no"),
      grn.vendor_id ? supabase.from("vendors").select("name").eq("id", grn.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
      // All open PO lines system-wide for component lookup
      supabase
        .from("po_lines")
        .select("id, po_id, component_id, project_id, qty_ordered, qty_received, purchase_orders(po_no)")
        .in("line_status", ["pending", "partial"]),
      // components tagged to this GRN's vendor (narrows the manual-entry picker)
      grn.vendor_id
        ? supabase.from("vendor_components").select("component_id").eq("vendor_id", grn.vendor_id)
        : Promise.resolve({ data: [] }),
    ]);
  const vendorComponentIds = (vendorComps ?? []).map((vc) => vc.component_id);

  const compLabel = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));

  // Inspection template fields for whichever components have one attached.
  const templateIds = [...new Set((components ?? []).map((c) => c.inspection_template_id).filter(Boolean))] as string[];
  const { data: templateFields } = templateIds.length
    ? await supabase
        .from("inspection_template_fields")
        .select("id, template_id, label, field_type, options, is_required")
        .in("template_id", templateIds)
        .eq("is_active", true)
        .order("sort_order")
    : { data: [] };
  const templateFieldsByTemplate: Record<string, { id: string; label: string; field_type: string; options: string[] | null; is_required: boolean }[]> = {};
  for (const f of templateFields ?? []) {
    (templateFieldsByTemplate[f.template_id] ??= []).push({
      id: f.id, label: f.label, field_type: f.field_type, options: (f.options as string[] | null) ?? null, is_required: f.is_required,
    });
  }

  // Per-component field eligibility (opt-out — presence here means the field
  // is NOT asked for that component). Small table, fetch in full.
  const { data: exclusions } = await supabase.from("component_inspection_field_exclusions").select("component_id, field_id");
  const excludedFieldIdsByComponent: Record<string, string[]> = {};
  for (const x of exclusions ?? []) {
    (excludedFieldIdsByComponent[x.component_id] ??= []).push(x.field_id);
  }

  // IRNs raised against this GRN (any status) — shown alongside posted lines.
  const { data: irns } = await supabase
    .from("irns")
    .select("id, irn_no, component_id, qty, status, generated_by, rejection_reason")
    .eq("grn_id", id)
    .order("created_at", { ascending: false });
  const irnGeneratorIds = [...new Set((irns ?? []).map((i) => i.generated_by))];
  const { data: irnGenerators } = irnGeneratorIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", irnGeneratorIds)
    : { data: [] };
  const generatorName = new Map((irnGenerators ?? []).map((p) => [p.id, p.full_name]));
  const irnRows = (irns ?? []).map((i) => ({
    id: i.id,
    irn_no: i.irn_no,
    component_label: i.component_id ? compLabel.get(i.component_id) ?? "—" : "—",
    qty: i.qty,
    status: i.status,
    generated_by: i.generated_by ? generatorName.get(i.generated_by) ?? "—" : "—",
    rejection_reason: i.rejection_reason,
  }));

  // existing open box lots (container_no set) — receivers can add pieces to a box
  const { data: openBoxes } = await supabase
    .from("inventory_lots")
    .select("id, component_id, lot_code, qty_on_hand, container_no")
    .eq("status", "open")
    .not("container_no", "is", null)
    .gt("qty_on_hand", 0);
  const openBoxesByComponent: Record<string, { id: string; lot_code: string; qty_on_hand: number; container_no: string | null }[]> = {};
  for (const b of openBoxes ?? []) {
    (openBoxesByComponent[b.component_id] ??= []).push({
      id: b.id, lot_code: b.lot_code, qty_on_hand: Number(b.qty_on_hand ?? 0), container_no: b.container_no,
    });
  }

  // lots created by this GRN's lines (for lot code display + sticker printing)
  const grnLineIds = (grnLines ?? []).map((l) => l.id);
  const { data: lineLots } = grnLineIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code, grn_line_id, status, project_id, source_lot_id").in("grn_line_id", grnLineIds)
    : { data: [] };
  // Project stock added to an existing box arrives as a reserved slice of that
  // box (no sticker of its own), so the line shows — and prints — the box.
  const lots = (lineLots ?? []).filter((l) => !l.source_lot_id);
  const boxSlices = (lineLots ?? []).filter((l) => l.source_lot_id);
  const boxIds = [...new Set(boxSlices.map((l) => l.source_lot_id as string))];
  const { data: boxes } = boxIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code").in("id", boxIds)
    : { data: [] };
  const boxById = new Map((boxes ?? []).map((b) => [b.id, b]));
  const lotByLine = new Map<string | null, { id: string; lot_code: string; status: string; project_id: string | null }>();
  for (const sl of boxSlices) {
    const box = boxById.get(sl.source_lot_id as string);
    if (box) lotByLine.set(sl.grn_line_id, { id: box.id, lot_code: box.lot_code, status: sl.status, project_id: sl.project_id });
  }
  for (const l of lots) lotByLine.set(l.grn_line_id, l);

  // Build a per-component map of ALL open PO lines (for the lookup hint in manual entry)
  const projNo = new Map((projects ?? []).map((p) => [p.id, p.project_no]));
  type OpenPoEntry = { po_line_id: string; po_no: string; tag: string; project_id: string | null; remaining: number };
  const openPoByComponent: Record<string, OpenPoEntry[]> = {};
  for (const pl of allOpenPoLines ?? []) {
    if (!pl.component_id) continue;
    const po = pl.purchase_orders as unknown as { po_no: string } | null;
    const remaining = Number(pl.qty_ordered ?? 0) - Number(pl.qty_received ?? 0);
    if (remaining <= 0) continue;
    const entry: OpenPoEntry = {
      po_line_id: pl.id,
      po_no: po?.po_no ?? "—",
      tag: pl.project_id ? `Project: ${projNo.get(pl.project_id) ?? pl.project_id}` : "Stock",
      project_id: pl.project_id ?? null,
      remaining,
    };
    (openPoByComponent[pl.component_id] ??= []).push(entry);
  }

  const postedLines = (grnLines ?? []).map((l) => {
    const lot = lotByLine.get(l.id);
    return {
      id: l.id,
      component_label: l.component_id ? compLabel.get(l.component_id) ?? "—" : "—",
      qty: l.qty_received,
      is_untagged: l.is_untagged,
      // Not yet turned into stock — the GRN carrying it isn't fully signed
      // yet, so there is genuinely no lot/QR for it (see migration 0096).
      pending: !(l as { processed_at?: string | null }).processed_at,
      lot_code: lot?.lot_code ?? null,
      lot_id: lot?.id ?? null,
      blocked_project: lot?.status === "issued" && lot.project_id ? projNo.get(lot.project_id) ?? null : null,
    };
  });
  const lotIds = lots.map((l) => l.id);

  return (
    <div>
      <Link href="/grn" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All goods receipts
      </Link>
      <PageHeader
        title={grn.grn_no}
        description={vendor?.data?.name ?? "no vendor"}
        action={
          <div className="flex items-center gap-3">
            {!signingState.fullySigned && signingState.canSignNow && (
              <DocumentSignButton
                documentId={id}
                signatures={mySignatures ?? []}
                signAction={signGrn}
                label={signingState.isBackfill ? "Sign (for the record)" : signingState.nextSlot === 1 ? "Sign" : "Sign as approver"}
                description={
                  signingState.isBackfill
                    ? "This GRN predates digital signatures — it already prints fine without one, but you can add yours for the record."
                    : "Required before this GRN can be printed."
                }
              />
            )}
            {!signingState.fullySigned && !signingState.canSignNow && !signingState.isBackfill && (
              <span className="text-sm text-muted-foreground">Awaiting signature</span>
            )}
            <Link href={`/grn/${id}/print`} className={buttonVariants({ variant: "outline" })}>
              <Printer className="size-4" /> Print
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <Info label="Challan" value={grn.challan_no} />
          <Info label="Invoice" value={grn.invoice_no} />
          <Info label="Received" value={formatDate(grn.received_at)} />
          <Info label="Lines" value={String(postedLines.length)} />
        </CardContent>
      </Card>

      <GrnReceiver
        grnId={id}
        postedLines={postedLines}
        components={(components ?? []).map((c) => ({ ...c, quantity_type: (c as { quantity_type?: string }).quantity_type ?? "nos", tracking_mode: (c as { tracking_mode?: string }).tracking_mode ?? "box" }))}
        projects={projects ?? []}
        openPoByComponent={openPoByComponent}
        openBoxesByComponent={openBoxesByComponent}
        lotIds={lotIds}
        canReceive={canReceive}
        vendorComponentIds={vendorComponentIds}
        vendorName={vendor?.data?.name ?? null}
        templateFieldsByTemplate={templateFieldsByTemplate}
        excludedFieldIdsByComponent={excludedFieldIdsByComponent}
        irnRows={irnRows}
        submitIrnAction={submitIrn}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}

// Job-work GRNs receive against open job-work lines for the GRN's own vendor
// (the vendor is fixed at GRN creation) — a separate, simpler picker than the
// PO-line-driven GrnReceiver, since there's no quantity-type/manual-cost variation.
async function JobWorkGrnPage({
  grnId, grn, canReceive, canSeeFinancials, signingState, mySignatures,
}: {
  grnId: string;
  grn: { grn_no: string; vendor_id: string | null; challan_no: string | null; received_at: string };
  canReceive: boolean;
  canSeeFinancials: boolean;
  signingState: Awaited<ReturnType<typeof getSigningState>>;
  mySignatures: MySignature[];
}) {
  const supabase = await createClient();
  const [vendor, { data: openLinesRaw }, { data: grnLines }] = await Promise.all([
    grn.vendor_id ? supabase.from("vendors").select("name").eq("id", grn.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    grn.vendor_id
      ? supabase
          .from("job_work_lines")
          .select("id, component_id, raw_lot_id, qty_sent, qty_returned, job_work_orders!inner(id, jw_no, vendor_id, status)")
          .in("job_work_orders.status", ["sent", "partial"])
          .eq("job_work_orders.vendor_id", grn.vendor_id)
      : Promise.resolve({ data: [] }),
    supabase.from("grn_lines").select("id, component_id, qty_received, unit_cost, jw_line_id").eq("grn_id", grnId).order("created_at"),
  ]);

  const openOutstanding = (openLinesRaw ?? [])
    .map((l) => ({ ...l, outstanding: Number(l.qty_sent ?? 0) - Number(l.qty_returned ?? 0) }))
    .filter((l) => l.outstanding > 0);

  const componentIds = [...new Set([
    ...openOutstanding.map((l) => l.component_id),
    ...(grnLines ?? []).map((l) => l.component_id),
  ].filter(Boolean))] as string[];
  const { data: components } = componentIds.length
    ? await supabase.from("components").select("id, component_no, name, inspection_template_id").in("id", componentIds)
    : { data: [] };
  const compById = new Map((components ?? []).map((c) => [c.id, c]));
  const compLabel = (id: string | null) => (id && compById.get(id) ? `${compById.get(id)!.component_no} — ${compById.get(id)!.name}` : "—");

  const rawLotIds = [...new Set(openOutstanding.map((l) => l.raw_lot_id).filter(Boolean))] as string[];
  const { data: rawLots } = rawLotIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code, grn_line_id").in("id", rawLotIds)
    : { data: [] };
  const rawLotById = new Map((rawLots ?? []).map((l) => [l.id, l]));

  const openLines: OpenJwLine[] = openOutstanding.map((l) => {
    const order = l.job_work_orders as unknown as { id: string; jw_no: string };
    const rawLot = l.raw_lot_id ? rawLotById.get(l.raw_lot_id) : undefined;
    return {
      id: l.id,
      component_id: l.component_id ?? "",
      component_label: compLabel(l.component_id),
      jw_no: order?.jw_no ?? "—",
      jw_order_id: order?.id ?? "",
      outstanding: l.outstanding,
      raw_lot_code: rawLot?.lot_code ?? "—",
    };
  });

  // ---- inspection checklist fields, per job-work component with an open line ----
  const templateIds = [...new Set(openOutstanding.map((l) => compById.get(l.component_id ?? "")?.inspection_template_id).filter(Boolean))] as string[];
  const [{ data: rawTemplateFields }, { data: exclusions }] = await Promise.all([
    templateIds.length
      ? supabase.from("inspection_template_fields")
          .select("id, template_id, label, field_type, options, is_required")
          .in("template_id", templateIds).eq("is_active", true).order("sort_order")
      : Promise.resolve({ data: [] }),
    supabase.from("component_inspection_field_exclusions").select("component_id, field_id").in("component_id", componentIds.length ? componentIds : [""]),
  ]);
  const fieldsByTemplate = new Map<string, TemplateField[]>();
  for (const f of rawTemplateFields ?? []) {
    const arr = fieldsByTemplate.get(f.template_id) ?? [];
    arr.push({ id: f.id, label: f.label, field_type: f.field_type, options: (f.options as string[] | null) ?? null, is_required: f.is_required });
    fieldsByTemplate.set(f.template_id, arr);
  }
  const excludedByComponent = new Map<string, Set<string>>();
  for (const x of exclusions ?? []) {
    const set = excludedByComponent.get(x.component_id) ?? new Set<string>();
    set.add(x.field_id);
    excludedByComponent.set(x.component_id, set);
  }
  const templateFieldsByComponent: Record<string, TemplateField[]> = {};
  for (const c of components ?? []) {
    if (!c.inspection_template_id) continue;
    const excluded = excludedByComponent.get(c.id) ?? new Set<string>();
    templateFieldsByComponent[c.id] = (fieldsByTemplate.get(c.inspection_template_id) ?? []).filter((f) => !excluded.has(f.id));
  }

  // ---- carry-forward: Heat No. / Test Certificate No. / MTC from the raw material's own approved IRN ----
  const rawGrnLineIds = [...new Set((rawLots ?? []).map((l) => l.grn_line_id).filter(Boolean))] as string[];
  const { data: rawIrns } = rawGrnLineIds.length
    ? await supabase.from("irns").select("id, grn_line_id").in("grn_line_id", rawGrnLineIds).eq("status", "approved")
    : { data: [] };
  const irnByGrnLine = new Map((rawIrns ?? []).map((i) => [i.grn_line_id, i.id]));
  const rawIrnIds = (rawIrns ?? []).map((i) => i.id);
  const { data: rawAnswers } = rawIrnIds.length
    ? await supabase.from("irn_answers").select("irn_id, field_id, text_value, choice_value").in("irn_id", rawIrnIds)
    : { data: [] };
  const rawAnswerFieldIds = [...new Set((rawAnswers ?? []).map((a) => a.field_id))];
  const { data: rawAnswerFields } = rawAnswerFieldIds.length
    ? await supabase.from("inspection_template_fields").select("id, label").in("id", rawAnswerFieldIds)
    : { data: [] };
  const labelByFieldId = new Map((rawAnswerFields ?? []).map((f) => [f.id, f.label]));
  const isCertField = (label: string) => /heat|certificate|\btc\b|\bmtc\b/i.test(label);
  const answersByIrn = new Map<string, Map<string, string>>();
  for (const a of rawAnswers ?? []) {
    const label = labelByFieldId.get(a.field_id);
    const value = a.text_value ?? a.choice_value;
    if (!label || !value || !isCertField(label)) continue;
    const m = answersByIrn.get(a.irn_id) ?? new Map<string, string>();
    m.set(label.trim().toLowerCase(), value);
    answersByIrn.set(a.irn_id, m);
  }
  const carryForwardByLine: Record<string, Record<string, string>> = {};
  for (const l of openOutstanding) {
    if (!l.raw_lot_id) continue;
    const grnLineId = rawLotById.get(l.raw_lot_id)?.grn_line_id;
    const irnId = grnLineId ? irnByGrnLine.get(grnLineId) : undefined;
    const answers = irnId ? answersByIrn.get(irnId) : undefined;
    if (answers) carryForwardByLine[l.id] = Object.fromEntries(answers);
  }

  // ---- posted lines: already-received job-work receipts on this GRN ----
  const postedJwLineIds = [...new Set((grnLines ?? []).map((l) => l.jw_line_id).filter(Boolean))] as string[];
  const { data: postedJwLines } = postedJwLineIds.length
    ? await supabase.from("job_work_lines").select("id, jw_order_id, job_work_orders(jw_no)").in("id", postedJwLineIds)
    : { data: [] };
  const jwNoByLine = new Map((postedJwLines ?? []).map((l) => [l.id, (l.job_work_orders as unknown as { jw_no: string } | null)?.jw_no ?? null]));

  // All IRNs on this GRN — approved ones map to a posted line; pending/rejected
  // ones have no grn_line yet and are surfaced separately so a deferred receipt
  // (team member, or an admin with no saved signature) still shows feedback.
  const { data: allIrns } = await supabase
    .from("irns")
    .select("id, irn_no, status, grn_line_id, component_id, qty")
    .eq("grn_id", grnId)
    .order("created_at");
  const irnByPostedLine = new Map((allIrns ?? []).filter((i) => i.grn_line_id).map((i) => [i.grn_line_id, i]));
  const pendingIrns: PendingJwIrn[] = (allIrns ?? [])
    .filter((i) => !i.grn_line_id && (i.status === "pending_approval" || i.status === "rejected"))
    .map((i) => ({
      id: i.id,
      irn_no: i.irn_no,
      component_label: compLabel(i.component_id),
      qty: Number(i.qty ?? 0),
      status: i.status,
    }));

  const postedLines: PostedJwLine[] = (grnLines ?? []).map((l) => {
    const irn = irnByPostedLine.get(l.id);
    return {
      id: l.id,
      component_label: compLabel(l.component_id),
      qty: Number(l.qty_received ?? 0),
      unit_cost: canSeeFinancials ? l.unit_cost : null,
      jw_no: l.jw_line_id ? jwNoByLine.get(l.jw_line_id) ?? null : null,
      irn_status: irn?.status ?? null,
      irn_no: irn?.irn_no ?? null,
      // Same deferred-until-fully-signed rule as the non-job-work GRN table.
      pending: !(l as { processed_at?: string | null }).processed_at,
    };
  });

  return (
    <div>
      <Link href="/grn" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All goods receipts
      </Link>
      <PageHeader
        title={grn.grn_no}
        description={vendor?.data?.name ? `Job Work · ${vendor.data.name}` : "Job Work"}
        action={
          <div className="flex items-center gap-3">
            {!signingState.fullySigned && signingState.canSignNow && (
              <DocumentSignButton
                documentId={grnId}
                signatures={mySignatures}
                signAction={signGrn}
                label={signingState.isBackfill ? "Sign (for the record)" : signingState.nextSlot === 1 ? "Sign" : "Sign as approver"}
                description={
                  signingState.isBackfill
                    ? "This GRN predates digital signatures — it already prints fine without one, but you can add yours for the record."
                    : "Required before this GRN can be printed."
                }
              />
            )}
            {!signingState.fullySigned && !signingState.canSignNow && !signingState.isBackfill && (
              <span className="text-sm text-muted-foreground">Awaiting signature</span>
            )}
            <Link href={`/grn/${grnId}/print`} className={buttonVariants({ variant: "outline" })}>
              <Printer className="size-4" /> Print
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <Info label="Vendor" value={vendor?.data?.name ?? null} />
          <Info label="Challan" value={grn.challan_no} />
          <Info label="Received" value={formatDate(grn.received_at)} />
          <Info label="Lines" value={String(postedLines.length)} />
        </CardContent>
      </Card>

      <JwGrnReceiver
        grnId={grnId}
        postedLines={postedLines}
        pendingIrns={pendingIrns}
        openLines={openLines}
        templateFieldsByComponent={templateFieldsByComponent}
        carryForwardByLine={carryForwardByLine}
        canReceive={canReceive}
        finance={canSeeFinancials}
      />
    </div>
  );
}

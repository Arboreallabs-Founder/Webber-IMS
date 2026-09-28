import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getVendors } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DocumentSignButton } from "@/components/document-sign-button";
import { getSigningState } from "@/lib/signatures";
import { formatDate } from "@/lib/utils";
import { GrnReceiver } from "./grn-receiver";
import { submitIrn } from "../irn-actions";
import { signGrn } from "../actions";
import { createComponentQuick } from "../../masters/bom-builder/actions";

export default async function GrnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const role = profile?.role;
  const canReceive = role === "admin" || role === "team_lead" || role === "team_member";
  const supabase = await createClient();

  const { data: grn } = await supabase.from("grns").select("*").eq("id", id).single();
  if (!grn) notFound();

  const [signingState, { data: mySignatures }] = await Promise.all([
    getSigningState("grn", id, grn.created_by, profile?.id ?? null, grn.created_at),
    profile ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", profile.id).order("is_default", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);

  const [{ data: grnLines }, { data: components }, { data: projects }, vendor, { data: allOpenPoLines }, { data: vendorComps }, allVendors, { data: inspectionTemplates }] =
    await Promise.all([
      supabase.from("grn_lines").select("*").eq("grn_id", id).order("created_at"),
      supabase.from("components").select("id, component_no, name, quantity_type, tracking_mode, inspection_template_id").order("component_no"),
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
      getVendors(),
      supabase.from("inspection_templates").select("id, name").eq("is_active", true).order("name"),
    ]);
  const vendorComponentIds = (vendorComps ?? []).map((vc) => vc.component_id);
  const vendorOptions = (allVendors ?? []).map((v) => ({ value: v.id, label: v.name }));
  const templateOptions = (inspectionTemplates ?? []).map((t) => ({ value: t.id, label: t.name }));

  // MPNs per component (one WPC can carry several, one per manufacturer) —
  // the receiving form offers whichever ones this component already has.
  const { data: mpnRows } = await supabase.from("component_mpns").select("id, component_id, mpn").order("created_at");
  const mpnsByComponent: Record<string, { id: string; mpn: string }[]> = {};
  for (const m of mpnRows ?? []) {
    (mpnsByComponent[m.component_id] ??= []).push({ id: m.id, mpn: m.mpn });
  }

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
    .select("id, component_id, lot_code, qty_on_hand, container_no, location")
    .eq("status", "open")
    .not("container_no", "is", null)
    .gt("qty_on_hand", 0);
  // Per-box MPN breakdown — a box can genuinely hold more than one MPN.
  const openBoxIds = (openBoxes ?? []).map((b) => b.id);
  const { data: boxMpnRows } = openBoxIds.length
    ? await supabase.from("inventory_lot_mpns").select("lot_id, qty, component_mpns(mpn)").in("lot_id", openBoxIds)
    : { data: [] };
  const mpnsByLot = new Map<string, { label: string; qty: number }[]>();
  for (const r of boxMpnRows ?? []) {
    const mpnRow = r.component_mpns as unknown as { mpn: string } | { mpn: string }[] | null;
    const label = (Array.isArray(mpnRow) ? mpnRow[0]?.mpn : mpnRow?.mpn) ?? "—";
    (mpnsByLot.get(r.lot_id) ?? mpnsByLot.set(r.lot_id, []).get(r.lot_id)!).push({ label, qty: Number(r.qty ?? 0) });
  }

  const openBoxesByComponent: Record<string, { id: string; lot_code: string; qty_on_hand: number; container_no: string | null; location: string | null; mpns: { label: string; qty: number }[] }[]> = {};
  for (const b of openBoxes ?? []) {
    (openBoxesByComponent[b.component_id] ??= []).push({
      id: b.id, lot_code: b.lot_code, qty_on_hand: Number(b.qty_on_hand ?? 0), container_no: b.container_no, location: b.location,
      mpns: mpnsByLot.get(b.id) ?? [],
    });
  }

  // lots created by this GRN's lines (for lot code display + sticker printing)
  const grnLineIds = (grnLines ?? []).map((l) => l.id);
  const { data: lots } = grnLineIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code, grn_line_id, status, project_id").in("grn_line_id", grnLineIds)
    : { data: [] };
  const lotByLine = new Map((lots ?? []).map((l) => [l.grn_line_id, l]));

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
      lot_code: lot?.lot_code ?? null,
      lot_id: lot?.id ?? null,
      blocked_project: lot?.status === "issued" && lot.project_id ? projNo.get(lot.project_id) ?? null : null,
    };
  });
  const lotIds = (lots ?? []).map((l) => l.id);

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
        canSeeFinancials={canSeeFinancials(role)}
        vendorComponentIds={vendorComponentIds}
        vendorName={vendor?.data?.name ?? null}
        vendorId={grn.vendor_id ?? null}
        templateFieldsByTemplate={templateFieldsByTemplate}
        excludedFieldIdsByComponent={excludedFieldIdsByComponent}
        irnRows={irnRows}
        submitIrnAction={submitIrn}
        createComponentAction={createComponentQuick}
        vendorOptions={vendorOptions}
        templateOptions={templateOptions}
        mpnsByComponent={mpnsByComponent}
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

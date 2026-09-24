import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, CheckCircle2, AlertTriangle, Clock, MinusCircle, Hammer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { DownloadExcelButton } from "@/components/download-excel-button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/utils";

// ---- Accounts View's own simple status (kept as originally confirmed — unrelated to the richer ladder below) ----
type AccountsStatus = "Not Ordered" | "PO Raised" | "Received" | "WIP";
function accountsMaterialStatus(hasPo: boolean, onHand: number, consumed: number, openOrderQty: number): AccountsStatus {
  if (onHand <= 0 && consumed > 0 && openOrderQty <= 0) return "WIP";
  if (onHand > 0 || consumed > 0) return "Received";
  if (hasPo) return "PO Raised";
  return "Not Ordered";
}

// ---- Material Status section's richer, single-status-per-component ladder ----
type MaterialStatus = "Not Ordered" | "PO Raised" | "PO Partial" | "Available" | "Blocked" | "WIP" | "Job Work";

const STATUS_META: Record<MaterialStatus, { label: string; icon: React.ElementType; className: string }> = {
  "Not Ordered": { label: "Not ordered", icon: MinusCircle, className: "text-muted-foreground" },
  "PO Raised": { label: "PO raised", icon: Clock, className: "text-blue-600" },
  "PO Partial": { label: "PO partial", icon: AlertTriangle, className: "text-amber-700" },
  Available: { label: "Available — not yet blocked", icon: CheckCircle2, className: "text-green-700" },
  Blocked: { label: "Blocked for this project", icon: Lock, className: "text-blue-700" },
  WIP: { label: "WIP", icon: CheckCircle2, className: "text-emerald-700" },
  "Job Work": { label: "Job work", icon: Hammer, className: "text-purple-700" },
};

function computeMaterialStatus({
  isJobWork, consumed, blockedMine, openAvailable, hasPo, orderedTotal, receivedTotal,
}: {
  isJobWork: boolean; consumed: number; blockedMine: number; openAvailable: number;
  hasPo: boolean; orderedTotal: number; receivedTotal: number;
}): MaterialStatus {
  if (isJobWork) return "Job Work";
  if (consumed > 0) return "WIP";
  if (blockedMine > 0) return "Blocked";
  if (openAvailable > 0) return "Available";
  if (hasPo && receivedTotal > 0 && receivedTotal < orderedTotal) return "PO Partial";
  if (hasPo && receivedTotal <= 0) return "PO Raised";
  if (hasPo) return "Available"; // fully received but not yet reflected as a lot — edge case fallback
  return "Not Ordered";
}

function stack(lines: string[]) {
  return lines.length ? lines.join("\n") : "—";
}

type Receipt = { qty: number; poId: string | null; poNo: string | null; grnId: string; grnNo: string; date: string | null };
function receiptText(r: Receipt) {
  return `${formatNumber(r.qty)} via ${r.poNo ?? "No PO"} → ${r.grnNo} (${r.date ? formatDate(r.date) : "—"})`;
}

export default async function ProjectReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: bom }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("boms").select("id, status").eq("project_id", id).maybeSingle(),
  ]);
  if (!project) notFound();

  const [{ data: customer }, { data: bomLines }, { data: shortfall }, { data: poLines }] = await Promise.all([
    project.customer_id ? supabase.from("customers").select("name").eq("id", project.customer_id).single() : Promise.resolve({ data: null }),
    bom ? supabase.from("bom_lines").select("id, component_id, required_qty, source, note").eq("bom_id", bom.id) : Promise.resolve({ data: [] }),
    supabase.from("v_project_shortfall")
      .select("component_id, required_qty, ordered_qty, on_hand, consumed_qty, sent_to_jw_qty, shortfall_qty")
      .eq("project_id", id),
    // Cancelled lines (e.g. superseded by a PO revision) never represent real
    // spend or receipts — excluded here so they don't inflate PO Value/Qty
    // totals or falsely imply "PO Raised" for the accounts/status exports.
    supabase.from("po_lines")
      .select("id, component_id, qty_ordered, rate, amount, qty_received, po_id")
      .eq("project_id", id)
      .neq("line_status", "cancelled"),
  ]);

  // Everything ever received for this project, scoped by grn_lines' own
  // project_id (not po_lines') so untagged/site-purchase receipts with no PO
  // at all are included too, not just PO-linked ones. Powers the PO/GRN
  // receipt links shown per material in the Material Status section.
  const { data: issuedGrnLines } = await supabase
    .from("grn_lines")
    .select("id, component_id, qty_received, grn_id, po_line_id")
    .eq("project_id", id);

  const issuedGrnIds = [...new Set((issuedGrnLines ?? []).map((g) => g.grn_id).filter((v): v is string => !!v))];
  const { data: issuedGrns } = issuedGrnIds.length
    ? await supabase.from("grns").select("id, grn_no, received_at").in("id", issuedGrnIds)
    : { data: [] };
  const issuedGrnById = new Map((issuedGrns ?? []).map((g) => [g.id, g]));

  const issuedPoLineIds = [...new Set((issuedGrnLines ?? []).map((g) => g.po_line_id).filter((v): v is string => !!v))];
  const { data: issuedPoLines } = issuedPoLineIds.length
    ? await supabase.from("po_lines").select("id, po_id").in("id", issuedPoLineIds)
    : { data: [] };
  const issuedPoIdByPoLine = new Map((issuedPoLines ?? []).map((p) => [p.id, p.po_id]));

  const issuedPoIds = [...new Set((issuedPoLines ?? []).map((p) => p.po_id).filter((v): v is string => !!v))];
  const { data: issuedPurchaseOrders } = issuedPoIds.length
    ? await supabase.from("purchase_orders").select("id, po_no").in("id", issuedPoIds)
    : { data: [] };
  const issuedPoNoById = new Map((issuedPurchaseOrders ?? []).map((p) => [p.id, p.po_no]));

  const poIds = [...new Set((poLines ?? []).map((p) => p.po_id).filter((v): v is string => !!v))];
  const { data: purchaseOrders } = poIds.length
    ? await supabase.from("purchase_orders").select("id, po_no, po_date, vendor_id").in("id", poIds)
    : { data: [] };
  const poById = new Map((purchaseOrders ?? []).map((p) => [p.id, p]));

  const vendorIds = [...new Set((purchaseOrders ?? []).map((p) => p.vendor_id).filter((v): v is string => !!v))];
  const { data: vendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendorNameById = new Map((vendors ?? []).map((v) => [v.id, v.name]));

  // Invoice No. lives on grns, not purchase_orders — reached via grn_lines.po_line_id.
  const poLineIds = (poLines ?? []).map((p) => p.id);
  const { data: grnLines } = poLineIds.length
    ? await supabase.from("grn_lines").select("po_line_id, grn_id").in("po_line_id", poLineIds)
    : { data: [] };
  const grnIds = [...new Set((grnLines ?? []).map((g) => g.grn_id).filter((v): v is string => !!v))];
  const { data: grns } = grnIds.length
    ? await supabase.from("grns").select("id, received_at, invoice_no").in("id", grnIds)
    : { data: [] };
  const grnById = new Map((grns ?? []).map((g) => [g.id, g]));
  const lastGrnDateByPoLine = new Map<string, string>();
  const invoiceNosByPoLine = new Map<string, Set<string>>();
  for (const gl of grnLines ?? []) {
    if (!gl.po_line_id) continue;
    const grn = grnById.get(gl.grn_id);
    if (!grn) continue;
    if (grn.received_at) {
      const existing = lastGrnDateByPoLine.get(gl.po_line_id);
      if (!existing || grn.received_at > existing) lastGrnDateByPoLine.set(gl.po_line_id, grn.received_at);
    }
    if (grn.invoice_no) {
      const set = invoiceNosByPoLine.get(gl.po_line_id) ?? new Set<string>();
      set.add(grn.invoice_no);
      invoiceNosByPoLine.set(gl.po_line_id, set);
    }
  }

  const allComponentIds = [...new Set([
    ...(bomLines ?? []).map((l) => l.component_id),
    ...(shortfall ?? []).map((s) => s.component_id),
    ...(poLines ?? []).map((p) => p.component_id),
    ...(issuedGrnLines ?? []).map((g) => g.component_id),
  ].filter((v): v is string => !!v))];
  const { data: components } = allComponentIds.length
    ? await supabase.from("components").select("id, component_no, name, uom, is_job_work").in("id", allComponentIds)
    : { data: [] };

  // v_project_shortfall only returns rows for components inside the project's
  // formal BOM tree — but plenty of real procurement (PO-only materials with
  // no BOM line) falls outside that tree entirely. For those, compute on-hand
  // / consumed directly (same source queries project_shortfall() itself uses)
  // so the exports don't silently show 0 for materials that clearly moved.
  const [{ data: onHandLots }, { data: consumedMoves }] = allComponentIds.length
    ? await Promise.all([
        supabase.from("inventory_lots").select("component_id, qty_on_hand, status, project_id")
          .in("component_id", allComponentIds).neq("status", "consumed").gt("qty_on_hand", 0),
        supabase.from("stock_movements").select("component_id, qty, reference_type")
          .in("component_id", allComponentIds).eq("movement_type", "issue").eq("project_id", id),
      ])
    : [{ data: [] }, { data: [] }];
  // Split on-hand lots into "blocked for this project" vs "open/available" —
  // mirrors projects/[id]/page.tsx's stockStatusRows computation exactly.
  const blockedByComponent = new Map<string, number>();
  const openByComponent = new Map<string, number>();
  for (const l of onHandLots ?? []) {
    if (!l.component_id) continue;
    if (l.status === "issued" && l.project_id === id) {
      blockedByComponent.set(l.component_id, (blockedByComponent.get(l.component_id) ?? 0) + Number(l.qty_on_hand ?? 0));
    } else if (l.status === "open" && (l.project_id === null || l.project_id === id)) {
      openByComponent.set(l.component_id, (openByComponent.get(l.component_id) ?? 0) + Number(l.qty_on_hand ?? 0));
    }
  }
  const fallbackOnHand = new Map<string, number>();
  for (const cid of new Set([...blockedByComponent.keys(), ...openByComponent.keys()])) {
    fallbackOnHand.set(cid, (blockedByComponent.get(cid) ?? 0) + (openByComponent.get(cid) ?? 0));
  }
  const fallbackConsumed = new Map<string, number>();
  for (const m of consumedMoves ?? []) {
    if (!m.component_id || m.reference_type === "job_work") continue;
    fallbackConsumed.set(m.component_id, (fallbackConsumed.get(m.component_id) ?? 0) + Number(-m.qty));
  }
  const compById = new Map((components ?? []).map((c) => [c.id, c]));
  const compLabel = (cid: string | null) => {
    const c = cid ? compById.get(cid) : null;
    return c ? `${c.component_no} — ${c.name}` : "—";
  };

  type PoLine = NonNullable<typeof poLines>[number];
  const poLinesByComponent = new Map<string, PoLine[]>();
  for (const pl of poLines ?? []) {
    if (!pl.component_id) continue;
    const group = poLinesByComponent.get(pl.component_id) ?? [];
    group.push(pl);
    poLinesByComponent.set(pl.component_id, group);
  }
  const hasPoByComponent = new Set([...poLinesByComponent.keys()]);

  // Receipts (PO → GRN) per component, for the Material Status section.
  const receiptsByComponent = new Map<string, Receipt[]>();
  for (const gl of issuedGrnLines ?? []) {
    const grn = gl.grn_id ? issuedGrnById.get(gl.grn_id) : null;
    if (!gl.component_id || !grn) continue;
    const poId = gl.po_line_id ? issuedPoIdByPoLine.get(gl.po_line_id) ?? null : null;
    const list = receiptsByComponent.get(gl.component_id) ?? [];
    list.push({
      qty: Number(gl.qty_received ?? 0),
      poId,
      poNo: poId ? issuedPoNoById.get(poId) ?? null : null,
      grnId: grn.id,
      grnNo: grn.grn_no,
      date: grn.received_at,
    });
    receiptsByComponent.set(gl.component_id, list);
  }
  for (const list of receiptsByComponent.values()) list.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // ---- 1. Approved BOM ----
  const bomRows = (bomLines ?? [])
    .slice()
    .sort((a, b) => compLabel(a.component_id).localeCompare(compLabel(b.component_id)))
    .map((l, i) => {
      const c = l.component_id ? compById.get(l.component_id) : null;
      return [i + 1, c?.component_no ?? "—", c?.name ?? "—", c?.uom ?? "—", Number(l.required_qty ?? 0), l.source, l.note ?? "—"];
    });
  const bomApproved = bom?.status === "approved";

  // ---- 2. Material Status (in-app table + download) ----
  const shortfallByComponent = new Map((shortfall ?? []).map((s) => [s.component_id, s]));

  function buildStatusRow(cid: string, required: number | null, isUnplanned: boolean) {
    const c = compById.get(cid);
    const isJobWork = c?.is_job_work ?? false;
    const lines = poLinesByComponent.get(cid) ?? [];
    const orderedTotal = lines.reduce((s, pl) => s + Number(pl.qty_ordered ?? 0), 0);
    const receivedTotal = lines.reduce((s, pl) => s + Number(pl.qty_received ?? 0), 0);
    const s = shortfallByComponent.get(cid);
    const consumed = s ? Number(s.consumed_qty ?? 0) : (fallbackConsumed.get(cid) ?? 0);
    const blockedMine = blockedByComponent.get(cid) ?? 0;
    const openAvailable = openByComponent.get(cid) ?? 0;
    const status = computeMaterialStatus({
      isJobWork, consumed, blockedMine, openAvailable,
      hasPo: lines.length > 0, orderedTotal, receivedTotal,
    });
    return {
      component_id: cid,
      component_no: c?.component_no ?? "—",
      name: c?.name ?? "—",
      uom: c?.uom ?? "—",
      required,
      isJobWork,
      isUnplanned,
      status,
      orderedTotal,
      receivedTotal,
      blockedMine,
      openAvailable,
      consumed,
      receipts: receiptsByComponent.get(cid) ?? [],
    };
  }

  const plannedComponentIds = new Set(
    bomApproved ? (bomLines ?? []).map((l) => l.component_id).filter((v): v is string => !!v) : [],
  );
  const plannedRows = bomApproved
    ? (bomLines ?? [])
        .slice()
        .filter((l): l is typeof l & { component_id: string } => !!l.component_id)
        .sort((a, b) => compLabel(a.component_id).localeCompare(compLabel(b.component_id)))
        .map((l) => buildStatusRow(l.component_id, Number(l.required_qty ?? 0), false))
    : [];

  // Anything with real activity for this project that isn't covered by the
  // approved BOM's own lines — whether because there's no approved BOM yet,
  // or the BOM simply doesn't include it. Mirrors issued-panel.tsx's "not in
  // plan" flagging, extended across the whole status ladder, not just consumed.
  const unplannedComponentIds = [...new Set([
    ...(shortfall ?? []).map((s) => s.component_id),
    ...hasPoByComponent,
    ...receiptsByComponent.keys(),
    ...[...fallbackConsumed.entries()].filter(([, qty]) => qty > 0).map(([cid]) => cid),
  ])].filter((cid): cid is string => !!cid && !plannedComponentIds.has(cid));

  const unplannedRows = unplannedComponentIds
    .slice()
    .sort((a, b) => compLabel(a).localeCompare(compLabel(b)))
    .map((cid) => buildStatusRow(cid, null, true));

  const materialStatusRows = [...plannedRows, ...unplannedRows];

  const materialStatusExcelRows = materialStatusRows.map((r, i) => [
    i + 1, r.component_no, r.name, r.uom, r.required ?? "—",
    STATUS_META[r.status].label + (r.isUnplanned ? " (Unplanned)" : ""),
    r.isJobWork ? "—" : formatNumber(r.orderedTotal),
    r.isJobWork ? "—" : formatNumber(r.receivedTotal),
    r.isJobWork ? "—" : formatNumber(r.blockedMine),
    r.isJobWork ? "—" : formatNumber(r.openAvailable),
    r.isJobWork ? "—" : formatNumber(r.consumed),
    r.isJobWork ? "—" : stack(r.receipts.map(receiptText)),
  ]);

  // ---- 3. Accounts View ----
  const deliveryDays = project.order_date && project.delivery_date
    ? Math.round((new Date(project.delivery_date).getTime() - new Date(project.order_date).getTime()) / 86400000)
    : null;
  const accountsComponentIds = [...new Set([...(shortfall ?? []).map((s) => s.component_id), ...hasPoByComponent])].filter((v): v is string => !!v);

  const qtyFmt = "#,##0.###";
  const accountsNumberFormats: Record<number, string> = {
    0: "0", 5: "0", 11: qtyFmt, 12: "#,##0.00", 13: "#,##0", 14: qtyFmt,
    15: qtyFmt, 16: qtyFmt, 17: qtyFmt, 18: "#,##0",
  };

  // One row per purchase PO line. Columns constant for a material (Sr. No.,
  // project columns, description, UOM, the component totals, status) appear once
  // on the material's first row; a blank row separates materials.
  const sortedAccountsIds = accountsComponentIds
    .slice()
    .sort((a, b) => compLabel(a).localeCompare(compLabel(b)));

  const accountsRows: (string | number | null)[][] = [];
  let accSr = 0;

  for (const cid of sortedAccountsIds) {
    const c = compById.get(cid);
    const lines = poLinesByComponent.get(cid) ?? [];

    let totalAmount = 0, totalQtyOrdered = 0, openOrderQty = 0;
    for (const pl of lines) {
      totalAmount += Number(pl.amount ?? 0);
      totalQtyOrdered += Number(pl.qty_ordered ?? 0);
      openOrderQty += Math.max(Number(pl.qty_ordered ?? 0) - Number(pl.qty_received ?? 0), 0);
    }
    // Prefer v_project_shortfall (matches the on-screen panel exactly for
    // BOM-tracked materials); fall back to direct on-hand/consumed sums for
    // materials procured via a project PO but not part of the formal BOM.
    const s = shortfallByComponent.get(cid);
    const onHand = s ? Number(s.on_hand ?? 0) : (fallbackOnHand.get(cid) ?? 0);
    const consumed = s ? Number(s.consumed_qty ?? 0) : (fallbackConsumed.get(cid) ?? 0);
    const totalAvailable = onHand + consumed;
    const weightedAvgRate = totalQtyOrdered > 0 ? totalAmount / totalQtyOrdered : null;
    const stockValue = weightedAvgRate !== null ? onHand * weightedAvgRate : null;
    const status = accountsMaterialStatus(lines.length > 0, onHand, consumed, openOrderQty);

    accSr += 1;

    type LineCells = {
      poNo: string; poDate: string; vendor: string;
      qty: number | null; rate: number | null; value: number | null; recv: number | null;
      grnDate: string; invoice: string;
    };
    // Label / identifying columns repeat on every PO-line row of the material.
    // The four component-aggregate numbers (15-18) appear once, on the first row,
    // so a straight column SUM in Excel stays correct for multi-line materials.
    const emit = (first: boolean, x: LineCells) => {
      accountsRows.push([
        accSr,                                                             // 0  Sr. No.
        customer?.name ?? "—",                                             // 1  Customer Name
        project.customer_po_number ?? "—",                                 // 2  Project PO No.
        project.order_date ? formatDate(project.order_date) : "—",         // 3  Project PO Date
        project.delivery_date ? formatDate(project.delivery_date) : "—",   // 4  Project Delivery Date
        deliveryDays ?? null,                                              // 5  Project Delivery Time (Days)
        x.poNo,                                                            // 6  Purchase PO No.
        x.poDate,                                                          // 7  Purchase PO Date
        x.vendor,                                                          // 8  Supplier/Vendor Name
        `${c?.component_no ?? "—"} — ${c?.name ?? "—"}`,                    // 9  Material Description
        c?.uom ?? "—",                                                     // 10 UOM
        x.qty,                                                             // 11 PO Qty
        x.rate,                                                            // 12 PO Rate
        x.value,                                                           // 13 PO Value
        x.recv,                                                            // 14 Received Qty
        first ? totalAvailable : null,                                     // 15 Total Available Qty
        first ? consumed : null,                                           // 16 WIP Qty
        first ? onHand : null,                                             // 17 Balance Stock
        first ? stockValue : null,                                         // 18 Stock Value
        x.grnDate,                                                         // 19 Last GRN Date
        status,                                                            // 20 Material Status
        x.invoice,                                                         // 21 Invoice No.
        "",                                                                // 22 Remarks
      ]);
    };

    if (lines.length === 0) {
      emit(true, { poNo: "—", poDate: "—", vendor: "—", qty: null, rate: null, value: null, recv: null, grnDate: "—", invoice: "—" });
      continue;
    }
    lines.forEach((pl, li) => {
      const po = pl.po_id ? poById.get(pl.po_id) : null;
      const invoices = invoiceNosByPoLine.get(pl.id);
      emit(li === 0, {
        poNo: po?.po_no ?? "—",
        poDate: po?.po_date ? formatDate(po.po_date) : "—",
        vendor: po?.vendor_id ? vendorNameById.get(po.vendor_id) ?? "—" : "—",
        qty: Number(pl.qty_ordered ?? 0),
        rate: Number(pl.rate ?? 0),
        value: Number(pl.amount ?? 0),
        recv: Number(pl.qty_received ?? 0),
        grnDate: lastGrnDateByPoLine.has(pl.id) ? formatDate(lastGrnDateByPoLine.get(pl.id)!) : "—",
        invoice: invoices && invoices.size ? [...invoices].join("; ") : "—",
      });
    });
  }

  return (
    <div>
      <Link href={`/projects/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to project
      </Link>
      <PageHeader title={`${project.project_no} — Reports`} description="Downloadable exports for procurement follow-up and accounts reconciliation." />

      <CollapsibleSection id="bom" title="Approved BOM" defaultOpen>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">
              {bomApproved ? `${bomRows.length} line(s) from the approved BOM.` : "The BOM must be approved before it can be downloaded — see the Bill of Materials section on the project page."}
            </p>
            <DownloadExcelButton
              label="Download BOM"
              filename={`${project.project_no}-BOM.xlsx`}
              sheetName="BOM"
              headers={["Sr. No.", "WPC", "Material Description", "UOM", "Required Qty", "Source", "Note"]}
              rows={bomRows}
              disabled={!bomApproved}
              colWidths={[8, 18, 36, 10, 14, 12, 30]}
            />
          </CardContent>
        </Card>
      </CollapsibleSection>

      <CollapsibleSection id="material-status" title="Material Status" defaultOpen>
        {materialStatusRows.length === 0 ? (
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">
                {bomApproved
                  ? "No BOM lines and no other material activity for this project yet."
                  : "The BOM isn't approved yet, and there's no other material activity for this project yet — see the Bill of Materials section on the project page."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {unplannedRows.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <p>
                  {unplannedRows.length} component{unplannedRows.length === 1 ? "" : "s"} with activity outside the approved BOM
                  {bomApproved ? "" : " (no approved BOM yet)"} — flagged below as "(Unplanned)".
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{materialStatusRows.length} material(s){bomApproved ? " (BOM + unplanned)" : " (unplanned — no approved BOM yet)"}.</p>
              <DownloadExcelButton
                label="Download Material Status"
                filename={`${project.project_no}-Material-Status.xlsx`}
                sheetName="Material Status"
                headers={["Sr. No.", "WPC", "Material Description", "UOM", "Required Qty", "Status", "Ordered Qty", "Received Qty", "Blocked Qty", "Available Qty", "WIP Qty", "Receipts (PO → GRN)"]}
                rows={materialStatusExcelRows}
                colWidths={[8, 18, 36, 10, 12, 14, 12, 12, 12, 12, 12, 40]}
              />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Blocked</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>WIP</TableHead>
                  <TableHead>Receipts (PO → GRN)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialStatusRows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No BOM lines.</TableCell></TableRow>
                ) : (
                  materialStatusRows.map((r) => {
                    const meta = STATUS_META[r.status];
                    const Icon = meta.icon;
                    return (
                      <TableRow key={r.component_id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {r.component_no} — {r.name}
                            {r.isUnplanned && <Badge variant="warning">Unplanned</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.uom}</TableCell>
                        <TableCell>{r.required !== null ? formatNumber(r.required) : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}>
                            <Icon className="size-3.5" /> {meta.label}{r.isUnplanned ? " (Unplanned)" : ""}
                          </span>
                        </TableCell>
                        {r.isJobWork ? (
                          <TableCell colSpan={6} className="text-muted-foreground">—</TableCell>
                        ) : (
                          <>
                            <TableCell>{formatNumber(r.orderedTotal)}</TableCell>
                            <TableCell>{formatNumber(r.receivedTotal)}</TableCell>
                            <TableCell>{formatNumber(r.blockedMine)}</TableCell>
                            <TableCell>{formatNumber(r.openAvailable)}</TableCell>
                            <TableCell>{formatNumber(r.consumed)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                {r.receipts.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  r.receipts.map((rc, i) => (
                                    <div key={i} className="flex flex-wrap items-center gap-1 text-sm">
                                      <span className="text-muted-foreground">{formatNumber(rc.qty)} via</span>
                                      {rc.poId && rc.poNo ? (
                                        <Link href={`/purchase-orders/${rc.poId}`} className="text-primary hover:underline">{rc.poNo}</Link>
                                      ) : (
                                        <span className="text-muted-foreground">No PO</span>
                                      )}
                                      <span className="text-muted-foreground">→</span>
                                      <Link href={`/grn/${rc.grnId}`} className="text-primary hover:underline">{rc.grnNo}</Link>
                                      <span className="text-xs text-muted-foreground">({formatDate(rc.date)})</span>
                                    </div>
                                  ))
                                )}
                              </div>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="accounts-view" title="Accounts View" defaultOpen>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-muted-foreground">{sortedAccountsIds.length} material(s) — procurement and consumption detail for accounts reconciliation.</p>
            <DownloadExcelButton
              label="Download Accounts View"
              filename={`${project.project_no}-Accounts-View.xlsx`}
              sheetName="Accounts View"
              headers={[
                "Sr. No.", "Customer Name", "Project PO No.", "Project PO Date", "Project Delivery Date", "Project Delivery Time (Days)",
                "Purchase PO No.", "Purchase PO Date", "Supplier/Vendor Name", "Material Description", "UOM",
                "PO Qty", "PO Rate", "PO Value", "Received Qty", "Total Available Qty", "WIP Qty", "Balance Stock",
                "Stock Value", "Last GRN Date", "Material Status", "Invoice No.", "Remarks",
              ]}
              rows={accountsRows}
              colWidths={[6, 20, 16, 14, 16, 12, 18, 14, 20, 36, 8, 10, 10, 12, 12, 14, 12, 12, 12, 14, 14, 14, 20]}
              numberFormats={accountsNumberFormats}
            />
          </CardContent>
        </Card>
      </CollapsibleSection>
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, canDownloadReports } from "@/lib/auth";
import { getVendors } from "@/lib/masters-data";
import { readAll } from "@/lib/server/read-all";
import { PageHeader } from "@/components/page-header";
import { formatINR } from "@/lib/utils";
import { InventoryTable, type InventoryRow, type BreakdownEntry } from "./inventory-table";

export default async function InventoryPage() {
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const canDownload = canDownloadReports(profile?.role);
  const supabase = await createClient();

  const view = finance ? "v_component_on_hand" : "v_component_on_hand_safe";
  const data = await readAll((f, t) => supabase.from(view as "v_component_on_hand").select("*").order("component_id").range(f, t));
  const allComponents = (data ?? []).map((r) => ({
    ...r,
    qty_on_hand: Number(r.qty_on_hand ?? 0),
    lot_count: (r as { lot_count?: number }).lot_count ?? 0,
    stock_value: (r as { stock_value?: number }).stock_value ?? null,
    has_stock_history: (r as { has_stock_history?: boolean }).has_stock_history ?? false,
  }));

  const totalValue = finance ? allComponents.reduce((s, r) => s + Number(r.stock_value ?? 0), 0) : null;

  // ---- Vendor / price / PO / GRN breakdown per component (for the Excel export) ----
  // Consumed lots are included on purpose: a fully-consumed component must still show its
  // real received qty, vendor, PO and GRN in the export (Balance just reads 0).
  //
  // Every table is read whole, in 1,000-row pages, in one parallel wave. There are
  // well over 1,000 lots and PO lines, and PostgREST truncates silently at 1,000 —
  // which made the export drop half the lots. Filtering by id lists instead builds
  // URLs past the header limit, which fails just as silently. Skipped entirely for
  // roles that can't download the export.
  const empty = Promise.resolve([] as never[]);
  const [lots, lotRates, receipts, consumption, grnLines, grns, poLines, purchaseOrders, projects, vendorRows] = await Promise.all([
    canDownload ? readAll((f, t) => supabase.from("inventory_lots").select("id, component_id, vendor_id, qty_on_hand, qty_initial, grn_line_id").order("id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("v_lot_rates").select("lot_id, rate, jw_charge").order("lot_id").range(f, t)) : empty,
    // Received qty per lot comes from the receipt ledger, not qty_initial: a box topped up
    // by a later GRN gets a receipt movement but its qty_initial is never raised. A job-work
    // receipt on a raw lot is a dispatch being credited back (order superseded), not new stock.
    canDownload ? readAll((f, t) => supabase.from("stock_movements").select("id, lot_id, qty").eq("movement_type", "receipt").or("reference_type.is.null,reference_type.neq.job_work").order("id").range(f, t)) : empty,
    // Which project(s) each component was actually *consumed* on — from the issue/return
    // ledger, netted, independent of the PO the stock was ordered against. Powers the
    // "WIP on Project" column in the Excel export.
    canDownload ? readAll((f, t) => supabase.from("v_project_consumption").select("project_id, component_id, consumed_qty").order("project_id").order("component_id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("grn_lines").select("id, po_line_id, grn_id").order("id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("grns").select("id, grn_no").order("id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("po_lines").select("id, project_id, po_id").order("id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("purchase_orders").select("id, po_no, po_date, gst_percent").order("id").range(f, t)) : empty,
    canDownload ? readAll((f, t) => supabase.from("projects").select("id, project_no").order("id").range(f, t)) : empty,
    getVendors(),
  ]);

  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));
  // Approved PO rate per lot (legacy typed cost only where there's no approved PO line).
  // A job-work return shows the job-work charge alone: its raw material is already a row
  // of its own at the PO rate, so the full rate would count it twice in the total.
  const rateByLot = new Map(lotRates.map((r) => [r.lot_id, r.jw_charge ?? r.rate]));
  const receivedByLot = new Map<string, number>();
  for (const m of receipts) if (m.lot_id) receivedByLot.set(m.lot_id, (receivedByLot.get(m.lot_id) ?? 0) + Number(m.qty ?? 0));
  // A lot with no receipt got its stock by transfer (an old-style split off another lot, whose
  // own receipt already counts it) — so it received nothing; qty_initial would double count.
  const receivedQty = (l: { id: string }) => receivedByLot.get(l.id) ?? 0;
  const poLineIdByGrnLine = new Map(grnLines.map((g) => [g.id, g.po_line_id]));
  const grnIdByGrnLine = new Map(grnLines.map((g) => [g.id, g.grn_id]));
  const grnNoById = new Map(grns.map((g) => [g.id, g.grn_no]));
  const poLineById = new Map(poLines.map((p) => [p.id, p]));
  const poById = new Map(purchaseOrders.map((p) => [p.id, p]));
  const projectNoById = new Map(projects.map((p) => [p.id, p.project_no]));

  // Group lots per component into receipt-groups: one entry per distinct po_line
  // (or per distinct vendor+rate for lots with no traceable PO, e.g. site purchases).
  const groupsByComponent = new Map<string, Map<string, { vendorId: string | null; rate: number | null; poLineId: string | null; qtyReceived: number; qtyBalance: number; grnNos: Set<string> }>>();
  for (const l of lots ?? []) {
    const poLineId = l.grn_line_id ? poLineIdByGrnLine.get(l.grn_line_id) ?? null : null;
    const poLine = poLineId ? poLineById.get(poLineId) : null;
    const rate = rateByLot.get(l.id) ?? null;
    const key = poLineId ?? `site:${l.vendor_id ?? "unknown"}:${rate ?? "0"}`;
    const grnNo = l.grn_line_id ? grnNoById.get(grnIdByGrnLine.get(l.grn_line_id) ?? "") ?? null : null;

    let compGroups = groupsByComponent.get(l.component_id);
    if (!compGroups) { compGroups = new Map(); groupsByComponent.set(l.component_id, compGroups); }

    const existing = compGroups.get(key);
    if (existing) {
      existing.qtyReceived += receivedQty(l);
      existing.qtyBalance += Number(l.qty_on_hand ?? 0);
      if (grnNo) existing.grnNos.add(grnNo);
    } else {
      compGroups.set(key, {
        vendorId: l.vendor_id,
        rate,
        poLineId,
        qtyReceived: receivedQty(l),
        qtyBalance: Number(l.qty_on_hand ?? 0),
        grnNos: new Set(grnNo ? [grnNo] : []),
      });
    }
  }

  const breakdownByComponent = new Map<string, BreakdownEntry[]>();
  for (const [componentId, compGroups] of groupsByComponent) {
    const entries: BreakdownEntry[] = [...compGroups.values()].map((g) => {
      const vendor = g.vendorId ? vendorById.get(g.vendorId) : null;
      const poLine = g.poLineId ? poLineById.get(g.poLineId) : null;
      const po = poLine?.po_id ? poById.get(poLine.po_id) : null;
      const projectNo = poLine?.project_id ? projectNoById.get(poLine.project_id) ?? null : null;
      return {
        vendorName: vendor?.name ?? "—",
        gstNo: vendor?.gst_no ?? null,
        pan: vendor?.pan ?? null,
        email: vendor?.email ?? null,
        website: vendor?.website ?? null,
        contact: vendor?.contact ?? null,
        rate: finance ? g.rate : null,
        gstPercent: finance ? po?.gst_percent ?? null : null,
        poNo: po?.po_no ?? null,
        poDate: po?.po_date ?? null,
        grnNos: [...g.grnNos].sort(),
        projectNo,
        qtyReceived: g.qtyReceived,
        qtyBalance: g.qtyBalance,
      };
    });
    breakdownByComponent.set(componentId, entries);
  }

  // component_id -> [{ projectNo, qty }] consumed, qty-descending, positives only
  const consumedByComponent = new Map<string, { projectNo: string; qty: number }[]>();
  for (const c of consumption ?? []) {
    const qty = Number(c.consumed_qty ?? 0);
    if (qty <= 0 || !c.component_id || !c.project_id) continue;
    const projectNo = projectNoById.get(c.project_id);
    if (!projectNo) continue;
    const list = consumedByComponent.get(c.component_id) ?? [];
    list.push({ projectNo, qty });
    consumedByComponent.set(c.component_id, list);
  }
  for (const list of consumedByComponent.values()) list.sort((a, b) => b.qty - a.qty);

  const onHandRows: InventoryRow[] = allComponents
    .filter((r) => r.qty_on_hand !== 0 || r.has_stock_history)
    .sort((a, b) => b.qty_on_hand - a.qty_on_hand)
    .map((r) => toRow(r, breakdownByComponent, consumedByComponent));

  const exportRows: InventoryRow[] = [
    ...onHandRows,
    ...allComponents
      .filter((r) => !r.has_stock_history)
      .sort((a, b) => a.component_no.localeCompare(b.component_no))
      .map((r) => toRow(r, breakdownByComponent, consumedByComponent)),
  ];

  return (
    <div>
      <PageHeader
        title="Inventory — On hand"
        description="Click a component to see its lots and quantities."
      />
      {totalValue !== null && (
        <p className="mb-4 text-sm text-muted-foreground">Total stock value: <span className="font-semibold text-foreground">{formatINR(totalValue)}</span></p>
      )}
      <InventoryTable finance={finance} canDownload={canDownload} rows={onHandRows} exportRows={canDownload ? exportRows : []} />
    </div>
  );
}

function toRow(
  r: { component_id: string; component_no: string; name: string; uom: string | null; qty_on_hand: number; lot_count: number; stock_value: number | null },
  breakdownByComponent: Map<string, BreakdownEntry[]>,
  consumedByComponent: Map<string, { projectNo: string; qty: number }[]>,
): InventoryRow {
  return {
    component_id: r.component_id,
    component_no: r.component_no,
    name: r.name,
    uom: r.uom,
    qty_on_hand: r.qty_on_hand,
    lot_count: r.lot_count ?? 0,
    stock_value: r.stock_value ?? null,
    breakdown: breakdownByComponent.get(r.component_id) ?? [],
    consumedProjects: consumedByComponent.get(r.component_id) ?? [],
  };
}

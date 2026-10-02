import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getVendors } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { formatINR } from "@/lib/utils";
import { InventoryTable, type InventoryRow, type BreakdownEntry } from "./inventory-table";

export default async function InventoryPage() {
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const view = finance ? "v_component_on_hand" : "v_component_on_hand_safe";
  const { data } = await supabase.from(view as "v_component_on_hand").select("*");
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
  // These reads used to run one after another, which cost nine serial round trips to
  // Postgres. They are issued here in dependency tiers instead: everything within a tier
  // is independent, so each tier is one round trip and the page waits five times, not
  // nine. Vendors come from the shared cached loader (`vendors_sel` is `using (true)`,
  // so it returns exactly what a per-request query would) and cost nothing at all.
  //
  // Neither read filters by `componentIds`. Doing so put all 512 ids in the query
  // string, which built a ~20 KB URL and made PostgREST reject the request for
  // exceeding the header limit — silently, since the failure surfaces only as a null
  // `data`, which is why the export's vendor/PO/GRN/rate columns came out blank. The
  // filter bought nothing anyway: both tables are keyed to components, so the maps
  // built below are only ever read for a component already on the page.
  const [{ data: lots }, { data: consumption }, vendorRows] = await Promise.all([
    supabase
      .from("inventory_lots")
      .select("id, component_id, vendor_id, qty_on_hand, qty_initial, unit_cost, grn_line_id, source_lot_id"),
    // Which project(s) each component was actually *consumed* on — from the issue/return
    // ledger, netted, independent of the PO the stock was ordered against. Powers the
    // "WIP on Project" column in the Excel export.
    supabase.from("v_project_consumption").select("project_id, component_id, consumed_qty"),
    getVendors(),
  ]);

  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

  // A reserved part carved out of a box (no GRN line of its own) is stock the
  // box already received: it belongs to the box's receipt group, and its
  // qty_initial must not be counted as a second receipt. A project receipt
  // added into a box carries its own grn_line_id and is a genuine receipt.
  const lotById = new Map((lots ?? []).map((l) => [l.id, l]));
  const carvedFrom = (l: { grn_line_id: string | null; source_lot_id: string | null }) =>
    !l.grn_line_id && l.source_lot_id ? lotById.get(l.source_lot_id) ?? null : null;

  const grnLineIds = [...new Set((lots ?? []).map((l) => l.grn_line_id).filter((v): v is string => !!v))];
  const { data: grnLines } = grnLineIds.length
    ? await supabase.from("grn_lines").select("id, po_line_id, grn_id").in("id", grnLineIds)
    : { data: [] };
  const poLineIdByGrnLine = new Map((grnLines ?? []).map((g) => [g.id, g.po_line_id]));
  const grnIdByGrnLine = new Map((grnLines ?? []).map((g) => [g.id, g.grn_id]));

  const grnIds = [...new Set((grnLines ?? []).map((g) => g.grn_id).filter((v): v is string => !!v))];
  const poLineIds = [...new Set((grnLines ?? []).map((g) => g.po_line_id).filter((v): v is string => !!v))];
  const [{ data: grns }, { data: poLines }] = await Promise.all([
    grnIds.length
      ? supabase.from("grns").select("id, grn_no").in("id", grnIds)
      : Promise.resolve({ data: [] }),
    poLineIds.length
      ? supabase.from("po_lines").select("id, rate, project_id, po_id").in("id", poLineIds)
      : Promise.resolve({ data: [] }),
  ]);
  const grnNoById = new Map((grns ?? []).map((g) => [g.id, g.grn_no]));
  const poLineById = new Map((poLines ?? []).map((p) => [p.id, p]));

  const poIds = [...new Set((poLines ?? []).map((p) => p.po_id).filter((v): v is string => !!v))];
  const projectIds = [
    ...new Set([
      ...(poLines ?? []).map((p) => p.project_id).filter((v): v is string => !!v),
      ...(consumption ?? []).map((c) => c.project_id).filter((v): v is string => !!v),
    ]),
  ];
  const [{ data: purchaseOrders }, { data: projects }] = await Promise.all([
    poIds.length
      ? supabase.from("purchase_orders").select("id, po_no, po_date, gst_percent").in("id", poIds)
      : Promise.resolve({ data: [] }),
    projectIds.length
      ? supabase.from("projects").select("id, project_no").in("id", projectIds)
      : Promise.resolve({ data: [] }),
  ]);
  const poById = new Map((purchaseOrders ?? []).map((p) => [p.id, p]));
  const projectNoById = new Map((projects ?? []).map((p) => [p.id, p.project_no]));

  // Group lots per component into receipt-groups: one entry per distinct po_line
  // (or per distinct vendor+rate for lots with no traceable PO, e.g. site purchases).
  const groupsByComponent = new Map<string, Map<string, { vendorId: string | null; rate: number | null; poLineId: string | null; qtyReceived: number; qtyBalance: number; grnNos: Set<string> }>>();
  for (const l of lots ?? []) {
    const box = carvedFrom(l);
    const src = box ?? l; // receipt identity: the box's, for a carved-out part
    const poLineId = src.grn_line_id ? poLineIdByGrnLine.get(src.grn_line_id) ?? null : null;
    const poLine = poLineId ? poLineById.get(poLineId) : null;
    const rate = poLine?.rate ?? src.unit_cost ?? null;
    const key = poLineId ?? `site:${src.vendor_id ?? "unknown"}:${rate ?? "0"}`;
    const grnNo = src.grn_line_id ? grnNoById.get(grnIdByGrnLine.get(src.grn_line_id) ?? "") ?? null : null;
    const received = box ? 0 : Number(l.qty_initial ?? 0);

    let compGroups = groupsByComponent.get(l.component_id);
    if (!compGroups) { compGroups = new Map(); groupsByComponent.set(l.component_id, compGroups); }

    const existing = compGroups.get(key);
    if (existing) {
      existing.qtyReceived += received;
      existing.qtyBalance += Number(l.qty_on_hand ?? 0);
      if (grnNo) existing.grnNos.add(grnNo);
    } else {
      compGroups.set(key, {
        vendorId: src.vendor_id,
        rate,
        poLineId,
        qtyReceived: received,
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
        rate: g.rate,
        gstPercent: po?.gst_percent ?? null,
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
      <InventoryTable finance={finance} rows={onHandRows} exportRows={exportRows} />
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

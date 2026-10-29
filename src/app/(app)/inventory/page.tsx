import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, canDownloadReports } from "@/lib/auth";
import { readAll } from "@/lib/server/read-all";
import { PageHeader } from "@/components/page-header";
import { formatINR } from "@/lib/utils";
import { InventoryTable, type InventoryRow } from "./inventory-table";
import { getInventoryExportRows } from "./export-data";

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

  // The Excel export's vendor / PO / GRN breakdown is built on demand by
  // getInventoryExportRows when someone presses Download, not on every visit.
  const onHandRows: InventoryRow[] = allComponents
    .filter((r) => r.qty_on_hand !== 0 || r.has_stock_history)
    .sort((a, b) => b.qty_on_hand - a.qty_on_hand)
    .map((r) => ({
      component_id: r.component_id,
      component_no: r.component_no,
      name: r.name,
      uom: r.uom,
      qty_on_hand: r.qty_on_hand,
      lot_count: r.lot_count ?? 0,
      stock_value: r.stock_value ?? null,
      breakdown: [],
      consumedProjects: [],
    }));

  return (
    <div>
      <PageHeader
        title="Inventory — On hand"
        description="Click a component to see its lots and quantities."
      />
      {totalValue !== null && (
        <p className="mb-4 text-sm text-muted-foreground">Total stock value: <span className="font-semibold text-foreground">{formatINR(totalValue)}</span></p>
      )}
      <InventoryTable finance={finance} canDownload={canDownload} rows={onHandRows} loadExportRows={getInventoryExportRows} />
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { ShoppingCart, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatINR, formatNumber } from "@/lib/utils";
import { RaisePoDialog } from "../projects/[id]/shortfall-panel";
import type { ActionResult } from "../purchase-orders/actions";
import type { ShortfallSupply } from "@/lib/server/shortfall-supply";

export type MinStockRow = {
  component_id: string;
  component_label: string;
  uom: string | null;
  is_consumable: boolean;
  min_qty: number;
  open_qty: number;
  on_order_qty: number;
  shortfall: number;
  /** Newest approved PO rate from any vendor (only for roles that see prices). */
  last_rate: number | null;
};

/** Components below their Master Data minimum, with tick + Raise PO for stock. */
export function MinStockPanel({
  rows,
  canProcure,
  supply,
  vendors,
  consumableVendorIds,
  showRates,
}: {
  rows: MinStockRow[];
  canProcure: boolean;
  supply: Record<string, ShortfallSupply>;
  vendors: { id: string; name: string }[];
  consumableVendorIds: string[];
  showRates: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [raised, setRaised] = React.useState<{ message?: string; created: NonNullable<ActionResult["created"]> } | null>(null);

  const selectedRows = rows.filter((r) => selected.has(r.component_id));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.component_id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function onRaised(res: ActionResult) {
    setDialogOpen(false);
    setSelected(new Set());
    // One PO → straight to it. Several → stay here and list every PO raised.
    if (res.created?.length === 1) {
      startNavProgress();
      router.push(`/purchase-orders/${res.created[0].id}`);
    } else {
      if (res.created?.length) setRaised({ message: res.message, created: res.created });
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {raised && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{raised.message ?? `Raised ${raised.created.length} POs.`}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {raised.created.map((c) => (
              <Link key={c.id} href={`/purchase-orders/${c.id}`} className="inline-flex items-center gap-1 underline">
                {c.po_no} — {c.vendor_name ?? "no supplier tagged"} <ArrowRight className="size-3.5" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-green-200 bg-green-50/50 px-4 py-3 text-sm text-green-700">
          ✓ All clear — every component with a minimum has enough open stock or is on order. Set minimums in Master Data → Components.
        </p>
      ) : (
        <>
          {canProcure && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="destructive"
                disabled={selectedRows.length === 0}
                onClick={() => { setRaised(null); setDialogOpen(true); }}
              >
                <ShoppingCart className="size-4" /> Raise PO{selectedRows.length ? ` (${selectedRows.length} selected)` : ""}
              </Button>
              {selectedRows.length === 0 && <span className="text-sm text-muted-foreground">Tick the components to order for stock.</span>}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {canProcure && (
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all components below minimum"
                      className="size-4 rounded border-input"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.component_id)))}
                    />
                  </TableHead>
                )}
                <TableHead>Component</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Minimum</TableHead>
                <TableHead>Open stock</TableHead>
                <TableHead>On order</TableHead>
                <TableHead>Shortfall</TableHead>
                {showRates && <TableHead>Last PO rate</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.component_id}>
                  {canProcure && (
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.component_label}`}
                        className="size-4 rounded border-input"
                        checked={selected.has(r.component_id)}
                        onChange={() => toggle(r.component_id)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    {r.component_label}
                    {r.is_consumable && <span className="block text-xs font-normal text-muted-foreground">Consumable</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.uom ?? "—"}</TableCell>
                  <TableCell>{formatNumber(r.min_qty)}</TableCell>
                  <TableCell>{formatNumber(r.open_qty)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatNumber(r.on_order_qty)}</TableCell>
                  <TableCell><Badge variant="destructive">{formatNumber(r.shortfall)}</Badge></TableCell>
                  {showRates && <TableCell className="text-muted-foreground">{r.last_rate == null ? "—" : formatINR(r.last_rate)}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Shortfall = minimum − open stock − still on order for stock (draft POs included). Blocked and WIP stock don&apos;t count.
          </p>
        </>
      )}

      {dialogOpen && (
        <RaisePoDialog
          projectId={null}
          rows={selectedRows}
          supply={supply}
          vendors={vendors}
          showRates={showRates}
          consumableIds={rows.filter((r) => r.is_consumable).map((r) => r.component_id)}
          consumableVendorIds={consumableVendorIds}
          onClose={() => setDialogOpen(false)}
          onRaised={onRaised}
        />
      )}
    </div>
  );
}

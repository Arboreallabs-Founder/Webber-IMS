"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { ShoppingCart, CheckCircle2, AlertTriangle, MinusCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { raisePoForSelectedShortfall } from "../../purchase-orders/actions";
import type { ActionResult } from "../../purchase-orders/actions";

type Row = {
  component_id: string;
  component_label: string;
  required: number;
  ordered: number;
  on_hand: number;
  consumed: number;
  sent_to_jw: number;
  shortfall: number;
};

/** Per short component: default supplier, vendors linked in Master Data, and rates to pre-fill. */
export type ShortfallSupply = {
  defaultVendorId: string | null;
  linkedVendorIds: string[];
  lastRateByVendor: Record<string, number>;
  priceByVendor: Record<string, number>;
};
type Vendor = { id: string; name: string };

export function ShortfallPanel({
  projectId,
  rows,
  canProcure,
  supply,
  vendors,
  showRates,
  consumableIds,
}: {
  projectId: string;
  rows: Row[];
  canProcure: boolean;
  supply: Record<string, ShortfallSupply>;
  vendors: Vendor[];
  showRates: boolean;
  /** Consumables: never ordered per project, so they can't be ticked here. */
  consumableIds: string[];
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [raised, setRaised] = React.useState<{ message?: string; created: NonNullable<ActionResult["created"]> } | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const consumable = React.useMemo(() => new Set(consumableIds), [consumableIds]);
  const shortRows = rows.filter((r) => r.shortfall > 0 && !consumable.has(r.component_id));
  const selectedRows = shortRows.filter((r) => selected.has(r.component_id));
  const allSelected = shortRows.length > 0 && shortRows.every((r) => selected.has(r.component_id));
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
    // One vendor → straight to that PO. Several → stay here and list every PO raised.
    if (res.created?.length === 1) {
      startNavProgress();
      router.push(`/purchase-orders/${res.created[0].id}`);
    } else {
      if (res.created?.length) setRaised({ message: res.message, created: res.created });
      router.refresh();
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Generate the BOM to see the stock-check shortfall.</p>;
  }

  return (
    <div className="space-y-4">
      {canProcure && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="destructive"
            disabled={selectedRows.length === 0}
            onClick={() => { setError(null); setRaised(null); setDialogOpen(true); }}
          >
            <ShoppingCart className="size-4" /> Raise PO for shortfall{selectedRows.length ? ` (${selectedRows.length} selected)` : ""}
          </Button>
          {shortRows.length > 0 && selectedRows.length === 0 && (
            <span className="text-sm text-muted-foreground">Tick the short components to order.</span>
          )}
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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

      <Table>
        <TableHeader>
          <TableRow>
            {canProcure && (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all short components"
                  className="size-4 rounded border-input"
                  checked={allSelected}
                  disabled={shortRows.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(shortRows.map((r) => r.component_id)))}
                />
              </TableHead>
            )}
            <TableHead>Component</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>On hand</TableHead>
            <TableHead>Ordered</TableHead>
            <TableHead>WIP</TableHead>
            <TableHead>Sent to JW</TableHead>
            <TableHead>Shortfall</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.component_id}>
              {canProcure && (
                <TableCell>
                  {r.shortfall > 0 && !consumable.has(r.component_id) && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.component_label}`}
                      className="size-4 rounded border-input"
                      checked={selected.has(r.component_id)}
                      onChange={() => toggle(r.component_id)}
                    />
                  )}
                </TableCell>
              )}
              <TableCell className="font-medium">
                {r.component_label}
                {consumable.has(r.component_id) && r.shortfall > 0 && (
                  <span className="block text-xs font-normal text-muted-foreground">Consumable — take it from consumables stock via requisition.</span>
                )}
              </TableCell>
              <TableCell>{formatNumber(r.required)}</TableCell>
              <TableCell>{formatNumber(r.on_hand)}</TableCell>
              <TableCell className="text-muted-foreground">{formatNumber(r.ordered)}</TableCell>
              <TableCell className="text-muted-foreground">{formatNumber(r.consumed)}</TableCell>
              <TableCell className="text-muted-foreground">{formatNumber(r.sent_to_jw)}</TableCell>
              <TableCell>
                {r.shortfall > 0
                  ? <Badge variant="destructive">{formatNumber(r.shortfall)}</Badge>
                  : <Badge variant="success">0</Badge>}
              </TableCell>
              <TableCell>
                {r.shortfall <= 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="size-3.5" /> Covered
                    {r.on_hand <= 0 && r.consumed > 0 ? " (in WIP)" : ""}
                    {r.on_hand <= 0 && r.consumed <= 0 && r.sent_to_jw > 0 ? " (in job-work)" : ""}
                  </span>
                ) : r.on_hand > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5" /> Partial stock
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MinusCircle className="size-3.5" /> No stock
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Issuing/consuming components into this project happens from Requisitions, not here.
      </p>

      {dialogOpen && (
        <RaisePoDialog
          projectId={projectId}
          rows={selectedRows}
          supply={supply}
          vendors={vendors}
          showRates={showRates}
          onClose={() => setDialogOpen(false)}
          onRaised={onRaised}
        />
      )}
    </div>
  );
}

type Line = { qty: string; vendorId: string; rate: string; rateTouched: boolean };

function RaisePoDialog({
  projectId,
  rows,
  supply,
  vendors,
  showRates,
  onClose,
  onRaised,
}: {
  projectId: string;
  rows: Row[];
  supply: Record<string, ShortfallSupply>;
  vendors: Vendor[];
  showRates: boolean;
  onClose: () => void;
  onRaised: (res: ActionResult) => void;
}) {
  // Rate to pre-fill for a component from a vendor: last approved PO rate, else Master Data price.
  const rateFor = (cid: string, vendorId: string) => {
    const s = supply[cid];
    const r = s?.lastRateByVendor[vendorId] ?? s?.priceByVendor[vendorId];
    return r == null ? "" : String(r);
  };
  const [lines, setLines] = React.useState<Record<string, Line>>(() =>
    Object.fromEntries(
      rows.map((r) => {
        const vendorId = supply[r.component_id]?.defaultVendorId ?? "";
        return [r.component_id, { qty: String(r.shortfall), vendorId, rate: vendorId ? rateFor(r.component_id, vendorId) : "", rateTouched: false }];
      }),
    ),
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const vendorName = React.useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors]);

  const set = (cid: string, patch: Partial<Line>) => setLines((l) => ({ ...l, [cid]: { ...l[cid], ...patch } }));
  const pickVendor = (cid: string, vendorId: string) =>
    setLines((l) => {
      const cur = l[cid];
      // A rate typed by hand stays; otherwise re-fill it for the new vendor.
      return { ...l, [cid]: { ...cur, vendorId, rate: cur.rateTouched ? cur.rate : rateFor(cid, vendorId) } };
    });

  const vendorCount = new Set(Object.values(lines).map((l) => l.vendorId).filter(Boolean)).size;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const r of rows) {
      const l = lines[r.component_id];
      if (!(Number(l.qty) > 0)) return setError(`${r.component_label}: enter a quantity above 0.`);
      if (!l.vendorId) return setError(`${r.component_label}: pick a vendor.`);
      if (l.rate !== "" && !(Number(l.rate) >= 0)) return setError(`${r.component_label}: the rate can't be negative.`);
    }
    const items = rows.map((r) => {
      const l = lines[r.component_id];
      return { component_id: r.component_id, qty: Number(l.qty), vendor_id: l.vendorId, rate: showRates && l.rate !== "" ? Number(l.rate) : null };
    });
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("items", JSON.stringify(items));
    setBusy(true);
    const res: ActionResult = await raisePoForSelectedShortfall(fd);
    setBusy(false);
    if (res?.error) return setError(res.error);
    onRaised(res);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Raise PO for shortfall"
      description="Confirm quantity, vendor and rate. One draft PO is raised per vendor; rates still go through price approval."
      className="max-w-4xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Component</th>
                <th className="px-3 py-2 font-medium">Short</th>
                <th className="px-3 py-2 font-medium">Qty to order</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                {showRates && <th className="px-3 py-2 font-medium">Rate (₹)</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const l = lines[r.component_id];
                const s = supply[r.component_id];
                const linked = [...new Set([...(s?.defaultVendorId ? [s.defaultVendorId] : []), ...(s?.linkedVendorIds ?? [])])]
                  .filter((v) => vendorName.has(v));
                const others = vendors.filter((v) => !linked.includes(v.id));
                const rateHint =
                  l.vendorId && s?.lastRateByVendor[l.vendorId] != null
                    ? "last PO rate"
                    : l.vendorId && s?.priceByVendor[l.vendorId] != null
                      ? "Master Data price"
                      : "no previous rate";
                return (
                  <tr key={r.component_id}>
                    <td className="px-3 py-2">{r.component_label}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(r.shortfall)}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="w-24"
                        aria-label={`Quantity of ${r.component_label}`}
                        value={l.qty}
                        onChange={(e) => set(r.component_id, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        className="min-w-[200px]"
                        aria-label={`Vendor for ${r.component_label}`}
                        value={l.vendorId}
                        onChange={(e) => pickVendor(r.component_id, e.target.value)}
                      >
                        <option value="">— pick a vendor —</option>
                        {linked.length > 0 && (
                          <optgroup label="Supplies this component">
                            {linked.map((v) => (
                              <option key={v} value={v}>{vendorName.get(v)}{v === s?.defaultVendorId ? " (default)" : ""}</option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="All vendors">
                          {others.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </optgroup>
                      </Select>
                    </td>
                    {showRates && (
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          className="w-28"
                          aria-label={`Rate for ${r.component_label}`}
                          value={l.rate}
                          placeholder="—"
                          onChange={(e) => set(r.component_id, { rate: e.target.value, rateTouched: true })}
                        />
                        {!l.rateTouched && <p className="mt-0.5 text-[11px] text-muted-foreground">{rateHint}</p>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-sm text-muted-foreground">{vendorCount > 1 ? `${vendorCount} vendors → ${vendorCount} draft POs` : vendorCount === 1 ? "1 draft PO" : ""}</span>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>
            <ShoppingCart className="size-4" /> Raise PO
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

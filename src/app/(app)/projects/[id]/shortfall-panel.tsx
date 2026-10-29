"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { ShoppingCart, CheckCircle2, AlertTriangle, MinusCircle, ArrowRight, Shuffle, Repeat, ClipboardList, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { raisePoForSelectedShortfall } from "../../purchase-orders/actions";
import type { ActionResult } from "../../purchase-orders/actions";
import type { ShortfallSupply } from "@/lib/server/shortfall-supply";

type Alternative = { component_id: string; label: string; on_hand: number };
type Row = {
  component_id: string;
  component_label: string;
  required: number;
  ordered: number;
  on_hand: number;
  consumed: number;
  sent_to_jw: number;
  shortfall: number;
  /** Of on_hand, the qty blocked for this project (the rest is open stock). */
  blocked_mine?: number;
  alternatives?: Alternative[];
};

/** What the BOM still needs of a component: required less consumed and out at job work. */
const stillNeeded = (r: Row) => Math.max(r.required - r.consumed - r.sent_to_jw, 0);
/** Qty a requisition starts at: what's still needed, as far as stock in hand (open + blocked here) covers it. */
const inStockForRequisition = (r: Row) => Math.min(stillNeeded(r), Math.max(r.on_hand, 0));

/**
 * "Covered" plus where the cover comes from, used in the same order the
 * shortfall itself is worked out: this project's blocked stock first, then
 * open stock, then open PO quantity. Open stock is left unsaid.
 */
function coveredDetail(r: Row): string {
  const outstanding = stillNeeded(r);
  if (outstanding <= 0) return r.consumed > 0 ? " (in WIP)" : "";
  const blocked = Math.min(r.blocked_mine ?? 0, outstanding);
  const open = Math.min(Math.max(r.on_hand - (r.blocked_mine ?? 0), 0), outstanding - blocked);
  const ordered = Math.min(r.ordered, outstanding - blocked - open);
  if (blocked === outstanding) return " & blocked";
  if (ordered === outstanding) return " & ordered";
  const parts = [blocked > 0 && `${formatNumber(blocked)} blocked`, ordered > 0 && `${formatNumber(ordered)} ordered`].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

type ReplaceResult = { ok?: true; error?: string; message?: string };
type RequisitionResult = { ok?: true; error?: string; id?: string };
type Vendor = { id: string; name: string };

export function ShortfallPanel({
  projectId,
  bomId,
  rows,
  canProcure,
  supply,
  vendors,
  showRates,
  consumableIds,
  replaceAction,
  raiseRequisitionAction,
}: {
  projectId: string;
  bomId?: string | null;
  rows: Row[];
  canProcure: boolean;
  supply: Record<string, ShortfallSupply>;
  vendors: Vendor[];
  showRates: boolean;
  /** Consumables: never ordered per project, so they can't be ticked here. */
  consumableIds: string[];
  replaceAction?: (fd: FormData) => Promise<ReplaceResult>;
  raiseRequisitionAction?: (fd: FormData) => Promise<RequisitionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [subMessage, setSubMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [raised, setRaised] = React.useState<{ message?: string; created: NonNullable<ActionResult["created"]> } | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [reqDialogOpen, setReqDialogOpen] = React.useState(false);

  // One tick column serves both buttons: short rows can go on a PO, rows with
  // stock in hand can go on a requisition (a partly-stocked row can do both).
  const consumable = React.useMemo(() => new Set(consumableIds), [consumableIds]);
  const canPo = (r: Row) => r.shortfall > 0 && !consumable.has(r.component_id);
  const canRequisition = (r: Row) => !!raiseRequisitionAction && inStockForRequisition(r) > 0;
  const shortRows = rows.filter(canPo);
  const tickable = rows.filter((r) => canPo(r) || canRequisition(r));
  const selectedRows = shortRows.filter((r) => selected.has(r.component_id));
  const selectedReqRows = rows.filter((r) => canRequisition(r) && selected.has(r.component_id));
  const allSelected = tickable.length > 0 && tickable.every((r) => selected.has(r.component_id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function replaceWithAlternative(componentId: string, alternativeId: string) {
    if (!replaceAction || !bomId) return;
    const key = `sub-${componentId}-${alternativeId}`;
    setBusy(key); setError(null); setSubMessage(null); setRaised(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("bom_id", bomId);
    fd.set("component_id", componentId);
    fd.set("alternative_id", alternativeId);
    const res = await replaceAction(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    setSubMessage(res.message ?? "Replaced.");
    router.refresh();
  }

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
          {raiseRequisitionAction && (
            <Button
              variant="outline"
              disabled={selectedReqRows.length === 0}
              onClick={() => { setError(null); setRaised(null); setReqDialogOpen(true); }}
            >
              <ClipboardList className="size-4" /> Raise requisition{selectedReqRows.length ? ` (${selectedReqRows.length} selected)` : ""}
            </Button>
          )}
          {tickable.length > 0 && selected.size === 0 && (
            <span className="text-sm text-muted-foreground">
              Tick short components to order them, or components in stock to requisition them.
            </span>
          )}
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {subMessage && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{subMessage}</p>}

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
                  aria-label="Select all components"
                  className="size-4 rounded border-input"
                  checked={allSelected}
                  disabled={tickable.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(tickable.map((r) => r.component_id)))}
                />
              </TableHead>
            )}
            <TableHead>Component</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>On hand</TableHead>
            <TableHead>Ordered</TableHead>
            <TableHead>WIP</TableHead>
            <TableHead>Shortfall</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.component_id} className="group">
              {canProcure && (
                <TableCell>
                  {(canPo(r) || canRequisition(r)) && (
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
              <TableCell>{formatNumber(Math.max(0, r.required))}</TableCell>
              <TableCell>{formatNumber(r.on_hand)}</TableCell>
              <TableCell className="text-muted-foreground">{formatNumber(r.ordered)}</TableCell>
              <TableCell className="text-muted-foreground">{formatNumber(r.consumed)}</TableCell>
              <TableCell>
                {r.shortfall > 0
                  ? <Badge variant="destructive">{formatNumber(r.shortfall)}</Badge>
                  : <Badge variant="success">0</Badge>}
              </TableCell>
              <TableCell>
                {r.shortfall <= 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="size-3.5" /> Covered{coveredDetail(r)}
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
                {r.shortfall > 0 && r.alternatives && r.alternatives.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {r.alternatives.map((a) => {
                      const key = `sub-${r.component_id}-${a.component_id}`;
                      return (
                        <div key={a.component_id} className="flex flex-wrap items-center gap-2 text-xs text-blue-700">
                          <span className="inline-flex items-center gap-1">
                            <Shuffle className="size-3 shrink-0" />
                            Available as alternative: {a.label} — {formatNumber(a.on_hand)}
                          </span>
                          {replaceAction && bomId && canProcure && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              loading={busy === key}
                              onClick={() => replaceWithAlternative(r.component_id, a.component_id)}
                              className="h-6 px-2 text-[11px] opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                            >
                              <Repeat className="size-3" /> Replace with in-stock alternative
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Stock is consumed into this project by scanning it on the requisition, not here.
      </p>

      {reqDialogOpen && raiseRequisitionAction && (
        <RaiseRequisitionDialog
          projectId={projectId}
          rows={selectedReqRows}
          action={raiseRequisitionAction}
          onClose={() => setReqDialogOpen(false)}
          onRaised={(id) => {
            setReqDialogOpen(false);
            setSelected(new Set());
            startNavProgress();
            router.push(`/requisitions/${id}`);
          }}
        />
      )}

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

/**
 * Confirm the quantity of each ticked in-stock component before the
 * requisition is raised. Starts at what's still needed (as far as stock
 * covers it) and can be changed up to what's still needed; the server checks
 * the same limits. Nothing is blocked here — the stock is scanned and
 * consumed on the requisition.
 */
function RaiseRequisitionDialog({
  projectId,
  rows: initialRows,
  action,
  onClose,
  onRaised,
}: {
  projectId: string;
  rows: Row[];
  action: (fd: FormData) => Promise<RequisitionResult>;
  onClose: () => void;
  onRaised: (requisitionId: string) => void;
}) {
  const [rows, setRows] = React.useState(initialRows);
  const [qty, setQty] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(initialRows.map((r) => [r.component_id, String(inStockForRequisition(r))])),
  );
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    for (const r of rows) {
      const q = Number(qty[r.component_id]);
      if (!(q > 0)) return setError(`${r.component_label}: enter a quantity above 0, or remove the line.`);
      if (q > stillNeeded(r)) return setError(`${r.component_label}: the BOM only still needs ${formatNumber(stillNeeded(r))}.`);
    }
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("items", JSON.stringify(rows.map((r) => ({ component_id: r.component_id, qty: Number(qty[r.component_id]) }))));
    setBusy(true);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) return setError(res.error);
    if (res.id) onRaised(res.id);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Raise requisition"
      description="Check the quantity for each component. The stock is then scanned and consumed on the requisition, which moves it into WIP."
      className="max-w-3xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Component</th>
                <th className="px-3 py-2 font-medium">Still needed</th>
                <th className="px-3 py-2 font-medium">In stock</th>
                <th className="px-3 py-2 font-medium">Qty to requisition</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const blocked = Math.min(r.blocked_mine ?? 0, r.on_hand);
                return (
                  <tr key={r.component_id}>
                    <td className="px-3 py-2">{r.component_label}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatNumber(stillNeeded(r))}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatNumber(r.on_hand)}
                      {blocked > 0 && <span className="block text-xs">{formatNumber(blocked)} blocked here</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        max={stillNeeded(r)}
                        className="w-24"
                        aria-label={`Quantity of ${r.component_label}`}
                        value={qty[r.component_id]}
                        onChange={(e) => setQty((q) => ({ ...q, [r.component_id]: e.target.value }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label={`Remove ${r.component_label}`}
                        onClick={() => setRows((rs) => rs.filter((x) => x.component_id !== r.component_id))}
                      >
                        <X className="size-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No components left — close and tick some.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={rows.length === 0}>
            <ClipboardList className="size-4" /> Raise requisition ({rows.length})
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

type Line = { qty: string; vendorId: string; rate: string; rateTouched: boolean };
type DialogRow = { component_id: string; component_label: string; shortfall: number };

/**
 * Confirm quantity, vendor and rate for the ticked short components, then raise
 * one draft PO per vendor. With no project (Action Center's Minimum stock) the
 * POs are for stock, and consumables — offered only consumables vendors — go on
 * their own Consumables PO.
 */
export function RaisePoDialog({
  projectId,
  rows,
  supply,
  vendors,
  showRates,
  consumableIds = [],
  consumableVendorIds = [],
  onClose,
  onRaised,
}: {
  projectId: string | null;
  rows: DialogRow[];
  supply: Record<string, ShortfallSupply>;
  vendors: Vendor[];
  showRates: boolean;
  consumableIds?: string[];
  consumableVendorIds?: string[];
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
        const def = supply[r.component_id]?.defaultVendorId ?? "";
        // A consumable's default supplier is pre-picked only if it is a consumables vendor.
        const vendorId = def && consumableIds.includes(r.component_id) && !consumableVendorIds.includes(def) ? "" : def;
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

  const consumable = React.useMemo(() => new Set(consumableIds), [consumableIds]);
  const consumablesVendor = React.useMemo(() => new Set(consumableVendorIds), [consumableVendorIds]);
  // One PO per vendor, and per kind: a vendor's consumables go on a separate Consumables PO.
  const vendorCount = new Set(
    rows.map((r) => lines[r.component_id].vendorId && `${lines[r.component_id].vendorId}|${consumable.has(r.component_id)}`).filter(Boolean),
  ).size;

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
    fd.set("project_id", projectId ?? "");
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
                // Consumables can only be bought from a consumables vendor.
                const allowed = (v: string) => vendorName.has(v) && (!consumable.has(r.component_id) || consumablesVendor.has(v));
                const linked = [...new Set([...(s?.defaultVendorId ? [s.defaultVendorId] : []), ...(s?.linkedVendorIds ?? [])])]
                  .filter(allowed);
                const others = vendors.filter((v) => !linked.includes(v.id) && allowed(v.id));
                const rateHint =
                  l.vendorId && s?.lastRateByVendor[l.vendorId] != null
                    ? "last PO rate"
                    : l.vendorId && s?.priceByVendor[l.vendorId] != null
                      ? "Master Data price"
                      : "no previous rate";
                return (
                  <tr key={r.component_id}>
                    <td className="px-3 py-2">
                      {r.component_label}
                      {consumable.has(r.component_id) && <span className="block text-xs text-muted-foreground">Consumable — Consumables PO</span>}
                    </td>
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
          <span className="mr-auto text-sm text-muted-foreground">{vendorCount > 1 ? `${vendorCount} draft POs` : vendorCount === 1 ? "1 draft PO" : ""}</span>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>
            <ShoppingCart className="size-4" /> Raise PO
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

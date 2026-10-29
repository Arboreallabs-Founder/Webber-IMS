"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, MinusCircle, PackageSearch, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber, APP_TIME_ZONE } from "@/lib/utils";
import type { ActionResult } from "./actions";

type Row = {
  component_id: string;
  component_label: string;
  planned: number;
  /** Everything ever issued to the project — what the BOM status is judged on. */
  issued: number;
  /** Of that, already sent to the client. */
  dispatched: number;
  in_plan: boolean;
};

export type OpenFinishedGood = { id: string; serial_no: string; label: string; status: string };
export type FgLineItem = { id: string; label: string; remaining: number };

/**
 * What's still in WIP for this project, against the BOM plan. Dispatched
 * material moves to the Dispatched tab, but still counts as issued here, so a
 * dispatched component never shows as "not issued" or "partially issued".
 * Tick components to dispatch them to the client with their finished goods.
 */
export function IssuedPanel({
  projectId,
  rows: allRows,
  canDispatch,
  openFinishedGoods,
  lineItems,
  dispatchAction,
}: {
  projectId: string;
  rows: Row[];
  canDispatch: boolean;
  openFinishedGoods: OpenFinishedGood[];
  lineItems: FgLineItem[];
  dispatchAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const [onlyIssued, setOnlyIssued] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  const wip = (r: Row) => Math.max(r.issued - r.dispatched, 0);
  // Fully dispatched components have left the factory — they're on the Dispatched tab.
  const inWipRows = allRows.filter((r) => !(r.issued > 1e-6 && wip(r) <= 1e-6));
  const rows = onlyIssued ? inWipRows.filter((r) => !r.in_plan || wip(r) > 1e-6) : inWipRows;
  const selectedRows = inWipRows.filter((r) => selected.has(r.component_id) && wip(r) > 1e-6);

  if (inWipRows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing in WIP for this project. Issue components via Requisitions; dispatched material is on the Dispatched tab.</p>;
  }

  const unplanned = rows.filter((r) => !r.in_plan);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectable = rows.filter((r) => wip(r) > 1e-6);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.component_id));

  return (
    <div className="space-y-4">
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyIssued}
          onChange={(e) => setOnlyIssued(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Show only issued
      </label>
      {done && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="size-4 shrink-0" /> {done}
        </div>
      )}
      {unplanned.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">{unplanned.length} component(s) issued that aren't in the BOM</p>
            <p className="mt-0.5 text-amber-700">Flagged below — confirm these were intentional.</p>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {canDispatch && (
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all in WIP"
                  className="size-4 rounded border-input"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.component_id)))
                  }
                />
              </TableHead>
            )}
            <TableHead>Component</TableHead>
            <TableHead>Planned</TableHead>
            <TableHead>In WIP</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={canDispatch ? 5 : 4} className="py-6 text-center text-muted-foreground">Nothing issued yet.</TableCell></TableRow>
          )}
          {rows.map((r) => (
            <TableRow key={r.component_id}>
              {canDispatch && (
                <TableCell>
                  {wip(r) > 1e-6 && (
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
                <div className="flex items-center gap-1.5">
                  {r.component_label}
                  {!r.in_plan && <Badge variant="warning">Not in plan</Badge>}
                </div>
              </TableCell>
              <TableCell>{r.in_plan ? formatNumber(r.planned) : <span className="text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                {formatNumber(wip(r))}
                {r.dispatched > 1e-6 && (
                  <span className="ml-1 text-xs text-muted-foreground">({formatNumber(r.issued)} issued)</span>
                )}
              </TableCell>
              <TableCell>
                {!r.in_plan ? (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <PackageSearch className="size-3.5" /> Unplanned
                  </span>
                ) : r.issued <= 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MinusCircle className="size-3.5" /> Not yet issued
                  </span>
                ) : r.issued - r.planned > 1e-6 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5" /> Over-issued by {formatNumber(r.issued - r.planned)}
                  </span>
                ) : r.issued >= r.planned ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="size-3.5" /> Fully issued
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5" /> Partially issued
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {canDispatch && selectedRows.length > 0 && (
        <div className="flex justify-end">
          <Button onClick={() => { setDone(null); setDialogOpen(true); }}>
            <Truck className="size-4" /> Dispatch to client ({selectedRows.length} selected)
          </Button>
        </div>
      )}

      {dialogOpen && (
        <DispatchDialog
          projectId={projectId}
          rows={selectedRows.map((r) => ({ ...r, wip: wip(r) }))}
          openFinishedGoods={openFinishedGoods}
          lineItems={lineItems}
          action={dispatchAction}
          onClose={() => setDialogOpen(false)}
          onDone={(msg) => {
            setDialogOpen(false);
            setSelected(new Set());
            setDone(msg);
          }}
        />
      )}
    </div>
  );
}

function DispatchDialog({
  projectId,
  rows,
  openFinishedGoods,
  lineItems,
  action,
  onClose,
  onDone,
}: {
  projectId: string;
  rows: (Row & { wip: number })[];
  openFinishedGoods: OpenFinishedGood[];
  lineItems: FgLineItem[];
  action: (fd: FormData) => Promise<ActionResult>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [qty, setQty] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.component_id, String(r.wip)])),
  );
  const [fgIds, setFgIds] = React.useState<Set<string>>(new Set());
  const [newQty, setNewQty] = React.useState(openFinishedGoods.length ? "0" : "1");
  const openLineItems = lineItems.filter((li) => li.remaining > 0);
  const [source, setSource] = React.useState<string>(openLineItems[0]?.id ?? "custom");
  const [customName, setCustomName] = React.useState("");
  const [date, setDate] = React.useState(() => new Date().toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE }));
  const [challan, setChallan] = React.useState("");
  const [vehicle, setVehicle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const newCount = Math.max(Math.floor(Number(newQty) || 0), 0);
  const unitCount = fgIds.size + newCount;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = rows.map((r) => ({ component_id: r.component_id, qty: Number(qty[r.component_id]) }));
    const bad = items.find((it, i) => !(it.qty > 0) || it.qty > rows[i].wip + 1e-9);
    if (bad) {
      const r = rows.find((x) => x.component_id === bad.component_id)!;
      setError(`${r.component_label}: enter a quantity between 0 and ${formatNumber(r.wip)}.`);
      return;
    }
    if (unitCount === 0) {
      setError("Pick or log at least one finished good.");
      return;
    }
    if (newCount > 0 && source === "custom" && !customName.trim()) {
      setError("Give the new finished good a name.");
      return;
    }
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("items", JSON.stringify(items));
    fd.set("fg_ids", JSON.stringify([...fgIds]));
    fd.set(
      "new_fg",
      JSON.stringify(
        newCount > 0
          ? source === "custom"
            ? { quantity: newCount, custom_name: customName.trim() }
            : { quantity: newCount, project_line_item_id: source }
          : null,
      ),
    );
    fd.set("dispatch_date", date);
    fd.set("challan_no", challan);
    fd.set("vehicle_no", vehicle);
    setBusy(true);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.refresh();
    onDone(res?.message ?? "Dispatched.");
  }

  return (
    <Dialog open onClose={onClose} title="Dispatch to client" description="Moves the material below out of WIP, with the finished good(s) it went into." className="max-w-2xl">
      <form onSubmit={submit} className="space-y-5">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Components</h3>
          <div className="divide-y divide-border rounded-md border border-border">
            {rows.map((r) => (
              <div key={r.component_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm">{r.component_label}</span>
                <span className="text-xs text-muted-foreground">in WIP {formatNumber(r.wip)}</span>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  max={r.wip}
                  className="w-24"
                  aria-label={`Quantity of ${r.component_label}`}
                  value={qty[r.component_id] ?? ""}
                  onChange={(e) => setQty((q) => ({ ...q, [r.component_id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Finished goods</h3>
          {openFinishedGoods.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Already logged on this project, not shipped yet:</p>
              {openFinishedGoods.map((fg) => (
                <label key={fg.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={fgIds.has(fg.id)}
                    onChange={() =>
                      setFgIds((s) => {
                        const n = new Set(s);
                        if (n.has(fg.id)) n.delete(fg.id);
                        else n.add(fg.id);
                        return n;
                      })
                    }
                  />
                  <span className="font-mono text-xs">{fg.serial_no}</span> {fg.label}
                  <Badge variant="secondary">{fg.status.replace("_", " ")}</Badge>
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-[6rem_1fr]">
            <div className="space-y-1.5">
              <Label>Log new</Label>
              <Input type="number" min="0" step="1" value={newQty} onChange={(e) => setNewQty(e.target.value)} aria-label="Number of new finished goods" />
            </div>
            <div className="space-y-1.5">
              <Label>What is it?</Label>
              <Select value={source} onChange={(e) => setSource(e.target.value)} disabled={newCount === 0}>
                {openLineItems.map((li) => (
                  <option key={li.id} value={li.id}>{li.label} — {li.remaining} left to log</option>
                ))}
                <option value="custom">Custom name…</option>
              </Select>
              {source === "custom" && newCount > 0 && (
                <Input placeholder="e.g. Triton 3600" value={customName} onChange={(e) => setCustomName(e.target.value)} />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {unitCount === 0 ? "No finished goods yet." : `${unitCount} unit(s) — each gets its own QR, all listing the components above.`}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Dispatch date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>Challan / invoice no.</Label>
            <Input value={challan} onChange={(e) => setChallan(e.target.value)} placeholder="optional" />
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle no.</Label>
            <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="optional" />
          </div>
        </section>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>
            <Truck className="size-4" /> Confirm dispatch
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

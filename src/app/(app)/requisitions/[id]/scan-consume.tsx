"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MinusCircle, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { QrScanner } from "@/components/qr-scanner";
import { resolveLot, consumeLot, type ResolvedLot } from "../../inventory/actions";

/**
 * Scan a lot's QR (or type its code) and consume it straight into this
 * requisition's project. For stock requisitions (no project) this is
 * admin-only and a reason is required — see `consumeLot`.
 */
export function ScanConsume({
  requisitionId,
  projectId,
  projectNo,
  requireReason,
  requiredByComponent,
}: {
  requisitionId: string;
  projectId: string | null;
  projectNo: string | null;
  requireReason: boolean;
  requiredByComponent: Record<string, number>;
}) {
  const router = useRouter();
  const [lot, setLot] = React.useState<ResolvedLot | null>(null);
  const [qty, setQty] = React.useState(0);
  // Locked to what's still outstanding when the part is on the requisition;
  // typed in (up to what's in the box) when it isn't — e.g. a requisition
  // made with "New requisition", which has no lines.
  const [qtyLocked, setQtyLocked] = React.useState(true);
  const [qtyNote, setQtyNote] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleDetect(code: string) {
    setPending(true);
    setError(null);
    setDone(null);
    setLot(null);
    const res = await resolveLot(code, projectId);
    setPending(false);
    if (res.error) { setError(res.error); return; }
    const resolved = res.lot ?? null;
    setLot(resolved);
    setReason("");

    setQtyLocked(true);
    if (!resolved) { setQty(0); setQtyNote(null); return; }

    // `available_qty` is this box's stock reserved for this project plus its
    // open stock — exactly what consume_from_lot will draw from. Stock
    // reserved inside the box for another project is never part of it.
    const available = resolved.available_qty;
    const onRequisition = !!resolved.component_id && resolved.component_id in requiredByComponent;
    const required = onRequisition ? requiredByComponent[resolved.component_id!] : 0;

    if (resolved.is_raw_job_work) {
      setQty(0);
      setQtyNote("Raw job-work stock — send it for job work before consuming.");
    } else if (available <= 0) {
      setQty(0);
      setQtyNote(
        resolved.reserved_elsewhere.length
          ? `Everything in this box is reserved for project ${resolved.reserved_elsewhere.map((r) => r.project_no).join(", ")} — can't consume here.`
          : "This box is empty.",
      );
    } else if (!onRequisition) {
      setQty(0);
      setQtyLocked(false);
      setQtyNote(`Not on this requisition — enter the qty to consume (up to ${available} available in this box).`);
    } else if (required <= 0) {
      setQty(0);
      setQtyNote("Nothing outstanding for this component on this requisition.");
    } else {
      setQty(Math.min(required, available));
      setQtyNote(
        available < required
          ? `Only ${available} available in this box — ${required} still needed overall.`
          : null,
      );
    }
  }

  async function handleConsume() {
    if (!lot || qty <= 0) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("lot_id", lot.id);
    fd.set("qty", String(qty));
    fd.set("requisition_id", requisitionId);
    if (projectId) fd.set("project_id", projectId);
    if (reason.trim()) fd.set("note", reason.trim());
    const res = await consumeLot(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    const parts = [
      res.fromReserved ? `${res.fromReserved} from reserved stock` : null,
      res.fromOpen ? `${res.fromOpen} from open stock` : null,
    ].filter(Boolean);
    setDone(
      `Consumed ${qty}${parts.length ? ` (${parts.join(" + ")})` : ""}.` +
        (res.released ? ` ${res.released} reserved elsewhere was no longer needed and went back to open stock.` : ""),
    );
    setLot(null);
    setQty(0);
    setQtyNote(null);
    setReason("");
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ScanLine className="size-4 text-muted-foreground" />
          Scan to consume {projectId ? `— project ${projectNo}` : "from stock"}
        </p>

        <QrScanner onDetect={handleDetect} pending={pending} />

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {done && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{done}</p>}

        {lot && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{lot.component_label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {lot.lot_code}
                  {lot.box_lot_code !== lot.lot_code && ` (in box ${lot.box_lot_code})`}
                </p>
                {lot.reserved_elsewhere.length > 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Also in this box, reserved for other projects (not usable here):{" "}
                    {lot.reserved_elsewhere.map((r) => `${r.project_no} × ${r.qty}`).join(", ")}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Available</p>
                <p className="text-xl font-semibold">{lot.available_qty}</p>
                {projectId && lot.reserved_qty > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {lot.reserved_qty} reserved for this project + {lot.open_qty} open
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="w-full sm:w-28">
                <Label className="mb-1 block text-xs">Qty to consume</Label>
                {qtyLocked ? (
                  <Input type="number" value={qty} readOnly disabled className="bg-muted" />
                ) : (
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    max={lot.available_qty}
                    value={qty || ""}
                    onChange={(e) => setQty(Math.min(Math.max(Number(e.target.value) || 0, 0), lot.available_qty))}
                    autoFocus
                  />
                )}
              </div>
              {requireReason && (
                <div className="w-full sm:min-w-[200px] sm:flex-1">
                  <Label className="mb-1 block text-xs">Reason</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="R&D, sample showing…" />
                </div>
              )}
              <Button className="w-full sm:w-auto" loading={busy} disabled={qty <= 0} onClick={handleConsume}>
                <MinusCircle className="size-4" /> Consume
              </Button>
            </div>
            {qtyNote && <p className="text-xs text-amber-600">{qtyNote}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

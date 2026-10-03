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
  const [pending, setPending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function handleDetect(code: string) {
    setPending(true);
    setError(null);
    setLot(null);
    const res = await resolveLot(code);
    setPending(false);
    if (res.error) { setError(res.error); return; }
    const resolved = res.lot ?? null;
    setLot(resolved);
    setReason("");

    setQtyLocked(true);
    if (!resolved) { setQty(0); setQtyNote(null); return; }

    // Blocked stock can only be drawn against the project it's actually
    // reserved for — mirrors consumeLot's own rule exactly: an 'issued' lot
    // tagged elsewhere is blocked outright, an 'open'-but-tagged lot (e.g.
    // arrived via a project-tagged PO) is only blocked when this requisition
    // belongs to a *different* project.
    const blockedElsewhere =
      resolved.status === "issued"
        ? resolved.project_no !== projectNo
        : !!projectId && resolved.project_no !== null && resolved.project_no !== projectNo;
    const onRequisition = !!resolved.component_id && resolved.component_id in requiredByComponent;
    const required = onRequisition ? requiredByComponent[resolved.component_id!] : 0;

    if (blockedElsewhere) {
      setQty(0);
      setQtyNote(`Reserved for project ${resolved.project_no} — can't consume here.`);
    } else if (!onRequisition) {
      setQty(0);
      setQtyLocked(false);
      setQtyNote(`Not on this requisition — enter the qty to consume (up to ${resolved.qty_on_hand} in this box).`);
    } else if (required <= 0) {
      setQty(0);
      setQtyNote("Nothing outstanding for this component on this requisition.");
    } else {
      setQty(Math.min(required, resolved.qty_on_hand));
      setQtyNote(
        resolved.qty_on_hand < required
          ? `Only ${resolved.qty_on_hand} in this box — ${required} still needed overall.`
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

        {lot && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{lot.component_label}</p>
                <p className="font-mono text-xs text-muted-foreground">{lot.lot_code}</p>
                {lot.project_no && lot.project_no !== projectNo && (
                  <p className="mt-1 text-xs text-amber-600">Currently tagged to project {lot.project_no}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">On hand</p>
                <p className="text-xl font-semibold">{lot.qty_on_hand}</p>
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
                    max={lot.qty_on_hand}
                    value={qty || ""}
                    onChange={(e) => setQty(Math.min(Math.max(Number(e.target.value) || 0, 0), lot.qty_on_hand))}
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

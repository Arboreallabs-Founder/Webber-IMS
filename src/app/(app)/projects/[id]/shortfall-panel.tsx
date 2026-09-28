"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { ShoppingCart, CheckCircle2, AlertTriangle, MinusCircle, ArrowRight, Shuffle, Repeat, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import { raisePoFromShortfall } from "../../purchase-orders/actions";
import type { ActionResult } from "../../purchase-orders/actions";

type Alternative = { component_id: string; label: string; on_hand: number };
type Row = {
  component_id: string;
  component_label: string;
  required: number;
  ordered: number;
  on_hand: number;
  consumed: number;
  shortfall: number;
  alternatives?: Alternative[];
};

type ReplaceResult = { ok?: true; error?: string; message?: string };
type RequisitionResult = { ok?: true; error?: string; id?: string };

export function ShortfallPanel({
  projectId,
  bomId,
  rows,
  canProcure,
  replaceAction,
  raiseRequisitionAction,
}: {
  projectId: string;
  bomId?: string | null;
  rows: Row[];
  canProcure: boolean;
  replaceAction?: (fd: FormData) => Promise<ReplaceResult>;
  raiseRequisitionAction?: (fd: FormData) => Promise<RequisitionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [raised, setRaised] = React.useState<{ message?: string; created: NonNullable<ActionResult["created"]> } | null>(null);
  const [subMessage, setSubMessage] = React.useState<string | null>(null);

  const hasShortfall = rows.some((r) => r.shortfall > 0);

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

  async function raisePo() {
    setBusy("po"); setError(null); setRaised(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    const res: ActionResult = await raisePoFromShortfall(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    // One supplier → straight to that PO (matches the old single-PO UX).
    // Multiple suppliers → stay here and list every PO that was raised.
    if (res.created?.length === 1) {
      startNavProgress();
      router.push(`/purchase-orders/${res.created[0].id}`);
    } else if (res.created?.length) {
      setRaised({ message: res.message, created: res.created });
      router.refresh();
    } else {
      router.refresh();
    }
  }

  async function raiseRequisition() {
    if (!raiseRequisitionAction) return;
    setBusy("req"); setError(null); setRaised(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    const res = await raiseRequisitionAction(fd);
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    if (res.id) {
      startNavProgress();
      router.push(`/requisitions/${res.id}`);
    } else {
      router.refresh();
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Generate the BOM to see the stock-check shortfall.</p>;
  }

  return (
    <div className="space-y-4">
      {canProcure && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            loading={busy === "po"} disabled={!hasShortfall}
            onClick={raisePo}
          >
            <ShoppingCart className="size-4" /> Raise PO for shortfall
          </Button>
          {raiseRequisitionAction && (
            <Button
              variant="outline"
              loading={busy === "req"} disabled={!hasShortfall}
              onClick={raiseRequisition}
            >
              <ClipboardList className="size-4" /> Raise requisition for shortfall
            </Button>
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
              <TableCell className="font-medium">{r.component_label}</TableCell>
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
                    <CheckCircle2 className="size-3.5" /> Covered
                    {r.on_hand <= 0 && r.consumed > 0 ? " (in WIP)" : ""}
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
        Issuing/consuming components into this project happens from Requisitions, not here.
      </p>
    </div>
  );
}

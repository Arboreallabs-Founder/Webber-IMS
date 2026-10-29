"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatINR, formatNumber } from "@/lib/utils";
import type { ActionResult } from "./actions";

export type DispatchRow = {
  id: string;
  dispatch_no: string;
  dispatch_date: string;
  challan_no: string | null;
  vehicle_no: string | null;
  status: "dispatched" | "cancelled";
  cancel_reason: string | null;
  units: { id: string; serial_no: string; label: string }[];
  lines: { component_label: string; qty: number; value: number | null }[];
  total_value: number | null;
};

/** Material sent to the client, one block per dispatch (cancelled ones greyed at the end). */
export function DispatchedPanel({
  projectId,
  dispatches,
  canCancel,
  cancelAction,
}: {
  projectId: string;
  dispatches: DispatchRow[];
  canCancel: boolean;
  cancelAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (dispatches.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing dispatched yet. Tick components on the Materials issued tab and press Dispatch to client.
      </p>
    );
  }

  async function cancel(d: DispatchRow) {
    const reason = prompt(`Cancel ${d.dispatch_no}? Its components go back to WIP and its units back to "ready".\n\nReason:`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Give a reason for cancelling.");
      return;
    }
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("dispatch_id", d.id);
    fd.set("reason", reason);
    setBusy(d.id);
    setError(null);
    const res = await cancelAction(fd);
    setBusy(null);
    if (res?.error) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {dispatches.map((d) => {
        const cancelled = d.status === "cancelled";
        return (
          <div key={d.id} className={`rounded-lg border border-border ${cancelled ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/40 px-4 py-2.5 text-sm">
              <span className="flex items-center gap-1.5 font-semibold">
                <Truck className="size-4" /> {d.dispatch_no}
              </span>
              <span>{formatDate(d.dispatch_date)}</span>
              {d.challan_no && <span className="text-muted-foreground">Challan {d.challan_no}</span>}
              {d.vehicle_no && <span className="text-muted-foreground">Vehicle {d.vehicle_no}</span>}
              {cancelled && <Badge variant="destructive">Cancelled</Badge>}
              {d.total_value !== null && !cancelled && <span className="ml-auto font-medium">{formatINR(d.total_value)}</span>}
              {canCancel && !cancelled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={d.total_value === null ? "ml-auto text-destructive" : "text-destructive"}
                  loading={busy === d.id}
                  onClick={() => cancel(d)}
                >
                  <XCircle className="size-4" /> Cancel
                </Button>
              )}
            </div>
            {cancelled && d.cancel_reason && (
              <p className="px-4 pt-2 text-xs text-muted-foreground">Cancelled: {d.cancel_reason}</p>
            )}
            <div className="flex flex-wrap gap-2 px-4 pt-3 text-sm">
              <span className="text-muted-foreground">Finished goods:</span>
              {d.units.length === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                d.units.map((u) => (
                  <Link key={u.id} href={`/finished-goods/${u.id}`} className="text-primary hover:underline">
                    <span className="font-mono text-xs">{u.serial_no}</span> {u.label}
                  </Link>
                ))
              )}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Qty dispatched</TableHead>
                  {d.total_value !== null && <TableHead>Value</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lines.map((l) => (
                  <TableRow key={l.component_label}>
                    <TableCell className="font-medium">{l.component_label}</TableCell>
                    <TableCell>{formatNumber(l.qty)}</TableCell>
                    {d.total_value !== null && <TableCell>{formatINR(l.value)}</TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

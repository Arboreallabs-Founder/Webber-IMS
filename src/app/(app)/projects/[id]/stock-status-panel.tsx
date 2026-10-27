"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatNumber } from "@/lib/utils";
import type { ActionResult } from "./actions";

export type StockStatusRow = {
  component_id: string;
  component_label: string;
  required: number;
  /** Already consumed on this project — netted off `required`, so it can't read as still-needed. */
  consumed_mine: number;
  blocked_mine: number;
  open_available: number;
  elsewhere: { project_no: string; qty: number }[];
  status: "in_wip" | "blocked" | "available" | "issued_elsewhere" | "out_of_stock";
  /** Consumables are never blocked — consumed straight from stock. */
  consumable?: boolean;
};

const STATUS_META: Record<StockStatusRow["status"], { label: string; icon: React.ElementType; className: string }> = {
  in_wip:           { label: "In WIP — already used",    icon: CheckCircle2,  className: "text-emerald-700" },
  blocked:          { label: "Blocked for this project", icon: Lock,          className: "text-blue-700" },
  available:        { label: "Available — not yet blocked", icon: CheckCircle2, className: "text-green-700" },
  issued_elsewhere: { label: "Issued to another project",  icon: AlertTriangle, className: "text-amber-700" },
  out_of_stock:     { label: "Out of stock",                icon: XCircle,       className: "text-muted-foreground" },
};

export function StockStatusPanel({
  projectId,
  bomId,
  bomApproved,
  rows,
  allJobWork = false,
  canWrite,
  blockAction,
}: {
  projectId: string;
  bomId: string | null;
  bomApproved: boolean;
  rows: StockStatusRow[];
  /** True when every planned component is job-work — see the Job work section above instead. */
  allJobWork?: boolean;
  canWrite: boolean;
  blockAction: (fd: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ message?: string; id?: string } | null>(null);

  async function onBlock() {
    if (!bomId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("bom_id", bomId);
    const res = await blockAction(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    setResult({ message: res.message, id: res.id });
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {allJobWork
          ? "Every component in this BOM is job-work — see the Job work section above instead."
          : "Generate the BOM to see stock status."}
      </p>
    );
  }

  const availableRows = rows.filter((r) => r.status === "available" && !r.consumable);

  return (
    <div className="space-y-4">
      {availableRows.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              Stock received — {availableRows.length} component{availableRows.length === 1 ? "" : "s"} available but not yet blocked for this project.
            </p>
            <p className="mt-0.5 text-amber-800">
              {availableRows.map((r) => r.component_label).join(", ")}
              {canWrite && bomApproved ? " — use “Block stock for BOM” below to reserve it." : ""}
            </p>
          </div>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={busy} disabled={!bomApproved} onClick={onBlock}>
            <Lock className="size-4" /> Block stock for BOM
          </Button>
          {!bomApproved && <span className="text-xs text-muted-foreground">Approve the BOM first.</span>}
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <p>{result.message}</p>
          {result.id && (
            <Link href={`/requisitions/${result.id}`} className="mt-1 inline-flex items-center gap-1 underline">
              Open requisition <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Component</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>In WIP</TableHead>
            <TableHead>Blocked (mine)</TableHead>
            <TableHead>Available</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const meta = STATUS_META[r.status];
            const Icon = meta.icon;
            return (
              <TableRow key={r.component_id}>
                <TableCell className="font-medium">
                  {r.component_label}
                  {r.consumable && (
                    <span className="block text-xs font-normal text-muted-foreground">Consumable — consumed directly, not blocked.</span>
                  )}
                </TableCell>
                <TableCell>{formatNumber(r.required)}</TableCell>
                <TableCell className={r.consumed_mine > 0 ? "text-emerald-700" : "text-muted-foreground"}>
                  {r.consumed_mine > 0 ? formatNumber(r.consumed_mine) : "—"}
                </TableCell>
                <TableCell>{formatNumber(r.blocked_mine)}</TableCell>
                <TableCell>{formatNumber(r.open_available)}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}>
                    <Icon className="size-3.5" /> {meta.label}
                  </span>
                  {/* Another project holding the same part is only a problem when
                      this one is actually short of it. When this project's own
                      demand is already covered, an unlabelled amber chip naming
                      someone else reads as a conflict that isn't there — so it is
                      labelled, and styled as plain context rather than a warning. */}
                  {r.elsewhere.length > 0 && (
                    <div className="mt-1">
                      <span className="text-[11px] text-muted-foreground">
                        {r.status === "issued_elsewhere" ? "Held by:" : "Also held by (not needed here):"}
                      </span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {r.elsewhere.map((e) => (
                          <Badge
                            key={e.project_no}
                            variant={r.status === "issued_elsewhere" ? "warning" : "secondary"}
                          >
                            {e.project_no} · {formatNumber(e.qty)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        Stock "issued to another project" can be freed from that component's Inventory page (admin/team lead → Unissue).
      </p>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startNavProgress } from "@/components/navigation-progress";
import { Hammer, CheckCircle2, AlertTriangle, Clock, MinusCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatNumber, formatDate } from "@/lib/utils";
import { raiseJobWorkFromProject, type ActionResult } from "../../job-work/actions";

export type JwStockRow = {
  component_id: string;
  component_label: string;
  required: number;
  raw_available: number;
  sent_outstanding: number;
  completed_available: number;
  status: "ready" | "needs_job_work" | "awaiting_return" | "no_stock";
};

export type JwOrderRow = {
  id: string;
  jw_no: string;
  vendor_name: string | null;
  status: string;
  sent_date: string | null;
  expected_date: string | null;
};

const STATUS_META: Record<JwStockRow["status"], { label: string; icon: React.ElementType; className: string }> = {
  ready:            { label: "Ready — completed stock covers it", icon: CheckCircle2, className: "text-green-700" },
  needs_job_work:   { label: "Needs job work", icon: AlertTriangle, className: "text-amber-700" },
  awaiting_return:  { label: "Sent — awaiting return from vendor", icon: Clock, className: "text-blue-700" },
  no_stock:         { label: "No raw or completed stock", icon: MinusCircle, className: "text-muted-foreground" },
};

const ORDER_STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary", sent: "warning", partial: "warning", received: "success", cancelled: "destructive",
};

export function JobWorkPanel({
  projectId,
  rows,
  orders,
  canWrite,
}: {
  projectId: string;
  rows: JwStockRow[];
  orders: JwOrderRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [raised, setRaised] = React.useState<{ message?: string; created: NonNullable<ActionResult["created"]> } | null>(null);

  const needsJobWork = rows.some((r) => r.status === "needs_job_work");

  async function onRaise() {
    setBusy(true); setError(null); setRaised(null);
    const fd = new FormData();
    fd.set("project_id", projectId);
    const res: ActionResult = await raiseJobWorkFromProject(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    if (res.created?.length === 1) {
      startNavProgress();
      router.push(`/job-work/${res.created[0].id}`);
    } else if (res.created?.length) {
      setRaised({ message: res.message, created: res.created });
      router.refresh();
    } else {
      router.refresh();
    }
  }

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No job-work components in this BOM.</p>;

  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} disabled={!needsJobWork} onClick={onRaise}>
            <Hammer className="size-4" /> Send raw stock for job work
          </Button>
          {!needsJobWork && <span className="self-center text-xs text-muted-foreground">Nothing needs job work right now.</span>}
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {raised && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{raised.message ?? `Raised ${raised.created.length} job-work order(s).`}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {raised.created.map((c) => (
              <Link key={c.id} href={`/job-work/${c.id}`} className="inline-flex items-center gap-1 underline">
                {c.jw_no} — {c.vendor_name ?? "no vendor tagged"} <ArrowRight className="size-3.5" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Raw (not sent)</TableHead>
              <TableHead>Sent (awaiting return)</TableHead>
              <TableHead>Completed available</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const meta = STATUS_META[r.status];
              const Icon = meta.icon;
              return (
                <TableRow key={r.component_id}>
                  <TableCell className="font-medium">{r.component_label}</TableCell>
                  <TableCell>{formatNumber(r.required)}</TableCell>
                  <TableCell>{formatNumber(r.raw_available)}</TableCell>
                  <TableCell>{formatNumber(r.sent_outstanding)}</TableCell>
                  <TableCell>{formatNumber(r.completed_available)}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}>
                      <Icon className="size-3.5" /> {meta.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 sm:hidden">
        {rows.map((r) => {
          const meta = STATUS_META[r.status];
          const Icon = meta.icon;
          return (
            <MobileRowCard
              key={r.component_id}
              title={r.component_label}
              badge={<span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}><Icon className="size-3.5" /> {meta.label}</span>}
              fields={[
                { label: "Required", value: formatNumber(r.required) },
                { label: "Raw (not sent)", value: formatNumber(r.raw_available) },
                { label: "Sent (awaiting return)", value: formatNumber(r.sent_outstanding) },
                { label: "Completed available", value: formatNumber(r.completed_available) },
              ]}
            />
          );
        })}
      </div>

      {orders.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job-work orders for this project</p>
          <div className="flex flex-wrap gap-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/job-work/${o.id}`}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
              >
                <span className="font-medium">{o.jw_no}</span>
                <span className="text-muted-foreground">{o.vendor_name ?? "—"}</span>
                <Badge variant={ORDER_STATUS_VARIANT[o.status] ?? "secondary"}>{o.status}</Badge>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

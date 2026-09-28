"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2, PackageCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatNumber } from "@/lib/utils";
import { removeReqLine, updateReqStatus, issueRequisition, type ActionResult } from "../actions";

type Line = { id: string; component_label: string; qty: number; consumed?: number };

const EPS = 1e-6;
function fulfillmentBadge(qty: number, consumed: number) {
  if (consumed >= qty - EPS) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="size-3.5" /> Done
      </span>
    );
  }
  if (consumed > EPS) {
    return <Badge variant="warning">{formatNumber(consumed)} / {formatNumber(qty)}</Badge>;
  }
  return null;
}

const STATUSES: { value: string; label: string }[] = [
  { value: "open",             label: "Open" },
  { value: "partially_issued", label: "Partially issued" },
  { value: "issued",           label: "Issued" },
  { value: "closed",           label: "Closed" },
];

export function RequisitionEditor({
  requisitionId,
  status,
  lines,
  canProcure,
  canRequest,
}: {
  requisitionId: string;
  status: string;
  lines: Line[];
  canProcure: boolean;
  canRequest: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(action: (fd: FormData) => Promise<ActionResult>, fd: FormData, onOk?: () => void) {
    setBusy(true);
    setError(null);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    onOk?.();
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {canProcure ? (
          <div className="flex items-center gap-2">
            <Label className="shrink-0">Status</Label>
            <Select
              value={status}
              disabled={busy}
              onChange={(e) => {
                const fd = new FormData();
                fd.set("id", requisitionId);
                fd.set("status", e.target.value);
                run(updateReqStatus, fd);
              }}
              className="max-w-[200px]"
            >
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            Status: {STATUSES.find((s) => s.value === status)?.label ?? status}
          </span>
        )}

        {canProcure && status === "open" && lines.length > 0 && (
          <Button
            className="ml-auto"
            loading={busy}
            onClick={() => {
              const fd = new FormData();
              fd.set("requisition_id", requisitionId);
              run(issueRequisition, fd);
            }}
          >
            <PackageCheck className="size-4" /> Issue from stock
          </Button>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {lines.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No lines yet.</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Qty requested</TableHead>
                  <TableHead>Consumed</TableHead>
                  {canRequest && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.component_label}</TableCell>
                    <TableCell>{formatNumber(l.qty)}</TableCell>
                    <TableCell>{fulfillmentBadge(l.qty, l.consumed ?? 0) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    {canRequest && (
                      <TableCell>
                        <Button
                          variant="ghost" size="icon" className="text-destructive" aria-label="Remove"
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("id", l.id);
                            fd.set("requisition_id", requisitionId);
                            run(removeReqLine, fd);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 sm:hidden">
            {lines.map((l) => (
              <MobileRowCard
                key={l.id}
                title={l.component_label}
                fields={[
                  { label: "Qty requested", value: formatNumber(l.qty) },
                  { label: "Consumed", value: fulfillmentBadge(l.qty, l.consumed ?? 0) ?? "—" },
                ]}
                actions={
                  canRequest ? (
                    <Button
                      variant="ghost" size="icon" className="text-destructive" aria-label="Remove"
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("id", l.id);
                        fd.set("requisition_id", requisitionId);
                        run(removeReqLine, fd);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

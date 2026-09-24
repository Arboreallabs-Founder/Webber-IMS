// No "use client" on purpose. This module is rendered two ways: as an RSC by
// `traceability/[lotCode]/page.tsx`, and as part of the client bundle when
// `traceability-scanner.tsx` (which is "use client") imports it. One source, so
// the scanned view and the linked view can never drift apart. That means it must
// stay free of both hooks and server-only imports.

import * as React from "react";
import Link from "next/link";
import { Package, FileText, ClipboardCheck, History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumber, formatINR } from "@/lib/utils";
import type { Traceability } from "@/lib/traceability";

/**
 * `finance` gates the cost row. The value is already stripped server-side in
 * `getLotTraceability` for roles that can't see it — this just avoids rendering
 * an empty "Unit cost —" row that implies the lot has no cost recorded.
 */
export function TraceabilityResult({ data, finance }: { data: Traceability; finance: boolean }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lot</h3>
            <Link
              href={`/inventory/lots/${data.lot.id}`}
              className="ml-auto text-sm font-medium text-primary hover:underline"
            >
              View lot &amp; ledger →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Info label="Component" value={data.lot.component_no ? `${data.lot.component_no} — ${data.lot.component_name}` : "—"} />
            <Info label="Lot code" value={data.lot.lot_code} mono />
            <Info label="Status" value={data.lot.status} />
            <Info label="On hand" value={`${formatNumber(data.lot.qty_on_hand)} / ${formatNumber(data.lot.qty_initial)} initial`} />
            {finance && <Info label="Unit cost" value={data.lot.unit_cost != null ? formatINR(data.lot.unit_cost) : "—"} />}
            <Info label="Created" value={formatDateTime(data.lot.created_at)} />
          </div>
        </CardContent>
      </Card>

      {data.lineage.length > 1 && (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lineage (raw → completed)</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {data.lineage.map((l, i) => (
                <React.Fragment key={l.lot_id}>
                  {i > 0 && <span className="text-muted-foreground">→</span>}
                  <Badge variant={l.jw_stage === "completed" ? "success" : "secondary"}>
                    {l.lot_code}{l.jw_stage ? ` (${l.jw_stage})` : ""}
                  </Badge>
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Purchase order &amp; receipt</h3>
          </div>
          {data.purchase_order?.po_no || data.grn ? (
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Info label="PO No." value={data.purchase_order?.po_no ?? "— (no PO)"} />
              <Info label="PO date" value={formatDate(data.purchase_order?.po_date ?? null)} />
              <Info label="Raised by" value={data.purchase_order?.raised_by ?? "—"} />
              <Info label="Supplier" value={data.purchase_order?.vendor_name ?? "—"} />
              <Info label="GRN No." value={data.grn?.grn_no ?? "—"} />
              <Info label="Challan" value={data.grn?.challan_no ?? "—"} />
              <Info label="Received by" value={data.grn?.received_by ?? "—"} />
              <Info label="Received" value={formatDateTime(data.grn?.received_at ?? null)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No PO/GRN on record for this lot (e.g. created directly, such as a site purchase).</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardCheck className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Inspection (IRN){data.irn.length > 1 ? ` — ${data.irn.length} entries` : ""}
            </h3>
          </div>
          {data.irn.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inspection was required for this component.</p>
          ) : (
            <div className="space-y-4">
              {data.irn.map((irn, i) => (
                <div key={i} className={i > 0 ? "border-t border-border pt-4" : ""}>
                  <div className="mb-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    <Info label="IRN No." value={irn.irn_no} mono />
                    <Info label="Template" value={irn.template_name ?? "—"} />
                    <Info label="Status" value={irn.status} />
                    <Info label="Generated by" value={irn.generated_by ?? "—"} />
                    <Info label="Generated" value={formatDateTime(irn.generated_at)} />
                    <Info label="Approved/Rejected by" value={irn.approved_by ?? "—"} />
                    <Info label="Decided" value={formatDateTime(irn.approved_at)} />
                    {irn.rejection_reason && <Info label="Reason" value={irn.rejection_reason} />}
                    {irn.approval_remarks && <Info label="Approver remarks" value={irn.approval_remarks} />}
                  </div>
                  {irn.checklist.length > 0 && (
                    <div className="rounded-md border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Checklist field</TableHead>
                            <TableHead>Answer</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {irn.checklist.map((c, ci) => (
                            <TableRow key={ci}>
                              <TableCell className="text-muted-foreground">{c.label}</TableCell>
                              <TableCell className="font-medium">{c.value ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Consumption history</h3>
          </div>
          {data.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.movements.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-muted-foreground">{formatDateTime(m.performed_at)}</TableCell>
                    <TableCell><Badge variant="secondary">{m.movement_type}</Badge></TableCell>
                    <TableCell className={Number(m.qty) < 0 ? "text-red-600" : "text-green-700"}>{formatNumber(m.qty)}</TableCell>
                    <TableCell>{m.project_no ?? "—"}</TableCell>
                    <TableCell>{m.performed_by ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{m.reference_type ?? "—"}{m.note ? ` — ${m.note}` : ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-medium ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</p>
    </div>
  );
}

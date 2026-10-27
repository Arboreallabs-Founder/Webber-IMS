"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DownloadPoRegisterButton, type PoRegisterRow } from "@/components/download-po-register-button";
import { formatDate, formatINR } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary",
  sent: "warning",
  partial: "warning",
  completed: "success",
  cancelled: "destructive",
  superseded: "secondary",
};

function overReceivedLabel(n: number) {
  return n === 1
    ? "1 line received more than was ordered — open the PO to review"
    : `${n} lines received more than was ordered — open the PO to review`;
}

export type PoRow = {
  id: string;
  po_no: string;
  vendor_name: string | null;
  po_date: string | null;
  status: string;
  total_amount: number | null;
  waiting_on?: string | null;
  /** Lines on this PO that received more than was ordered. 0 for a normal PO. */
  over_received_lines?: number;
};

export function AllPosTable({
  pos,
  finance,
  canDownload,
  poRegisterRows,
  basePath = "/purchase-orders",
}: {
  pos: PoRow[];
  finance: boolean;
  canDownload: boolean;
  poRegisterRows: PoRegisterRow[];
  /** "/consumables" when listing the Consumables module. */
  basePath?: string;
}) {
  const [query, setQuery] = React.useState("");
  const filtered = pos.filter((po) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return po.po_no.toLowerCase().includes(q) || (po.vendor_name ?? "").toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search PO no. or vendor…" />
        <p className="text-sm text-muted-foreground">{filtered.length} of {pos.length}</p>
        {canDownload && <DownloadPoRegisterButton rows={poRegisterRows} finance={finance} className="ml-auto" />}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PO No.</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            {finance && <TableHead>Total</TableHead>}
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={finance ? 6 : 5} className="py-8 text-center text-muted-foreground">{pos.length === 0 ? "No purchase orders yet." : "No matches."}</TableCell></TableRow>
          ) : (
            filtered.map((po) => (
              <TableRow key={po.id}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {po.po_no}
                    {!!po.over_received_lines && (
                      <span
                        title={overReceivedLabel(po.over_received_lines)}
                        aria-label={overReceivedLabel(po.over_received_lines)}
                        role="img"
                        className="inline-flex text-destructive"
                      >
                        <AlertTriangle className="size-4 shrink-0" />
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell>{po.vendor_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(po.po_date)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[po.status] ?? "secondary"}>{po.status}</Badge>
                  {po.waiting_on && <p className="mt-0.5 text-[11px] text-muted-foreground">waiting on {po.waiting_on}</p>}
                </TableCell>
                {finance && <TableCell>{formatINR(po.total_amount)}</TableCell>}
                <TableCell className="text-right">
                  <Link href={`${basePath}/${po.id}`} aria-label="Open" className={buttonVariants({ variant: "ghost", size: "icon" })}>
                    <ArrowRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DownloadPoRegisterButton, type PoRegisterRow } from "@/components/download-po-register-button";
import { formatDate, formatNumber } from "@/lib/utils";

export type GrnRow = {
  id: string;
  grn_no: string;
  vendor_name: string | null;
  challan_no: string | null;
  invoice_no: string | null;
  line_count: number;
  received_at: string | null;
};

export function AllGrnsTable({
  rows,
  poRegisterRows,
  finance,
}: {
  rows: GrnRow[];
  poRegisterRows: PoRegisterRow[];
  finance: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const filtered = rows.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.grn_no.toLowerCase().includes(q) ||
      (r.vendor_name ?? "").toLowerCase().includes(q) ||
      (r.challan_no ?? "").toLowerCase().includes(q) ||
      (r.invoice_no ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search GRN no., vendor, challan, or invoice…" />
        <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length}</p>
        <DownloadPoRegisterButton rows={poRegisterRows} finance={finance} className="ml-auto" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>GRN No.</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Challan</TableHead>
            <TableHead>Invoice</TableHead>
            <TableHead>Lines</TableHead>
            <TableHead>Received</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                {rows.length === 0 ? "No goods receipts yet." : "No matches."}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.grn_no}</TableCell>
                <TableCell>{g.vendor_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-muted-foreground">{g.challan_no ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{g.invoice_no ?? "—"}</TableCell>
                <TableCell>{formatNumber(g.line_count)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(g.received_at)}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/grn/${g.id}`} aria-label="Open" className={buttonVariants({ variant: "ghost", size: "icon" })}>
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

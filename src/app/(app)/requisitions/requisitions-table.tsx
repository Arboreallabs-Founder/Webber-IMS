"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatDate, formatNumber } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "secondary" | "warning" | "success"> = {
  open: "warning",
  partially_issued: "warning",
  issued: "secondary",
  closed: "success",
};

export type RequisitionRow = {
  id: string;
  req_no: string;
  project_id: string | null;
  project_label: string | null;
  status: string;
  line_count: number;
  created_at: string | null;
};

export function RequisitionsTable({ reqs }: { reqs: RequisitionRow[] }) {
  const [query, setQuery] = React.useState("");
  const filtered = reqs.filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return r.req_no.toLowerCase().includes(q) || (r.project_label ?? "").toLowerCase().includes(q);
  });

  if (reqs.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">No requisitions yet.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search req. no. or project…" />
        <p className="text-sm text-muted-foreground">{filtered.length} of {reqs.length}</p>
      </div>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Req No.</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No matches.</TableCell></TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.req_no}</TableCell>
                  <TableCell>{r.project_id ? r.project_label ?? "—" : <span className="text-muted-foreground">stock</span>}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge></TableCell>
                  <TableCell>{formatNumber(r.line_count)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/requisitions/${r.id}`} aria-label="Open" className={buttonVariants({ variant: "ghost", size: "icon" })}>
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 sm:hidden">
        {filtered.map((r) => (
          <Link key={r.id} href={`/requisitions/${r.id}`} className="block">
            <MobileRowCard
              title={r.req_no}
              subtitle={r.project_id ? r.project_label ?? "—" : "stock"}
              badge={<Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>}
              fields={[
                { label: "Lines", value: formatNumber(r.line_count) },
                { label: "Created", value: formatDate(r.created_at) },
              ]}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

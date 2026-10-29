"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatINR, formatNumber, formatDate } from "@/lib/utils";
import { downloadSheet } from "@/lib/xlsx-format";

export type BreakdownEntry = {
  vendorName: string;
  gstNo: string | null;
  pan: string | null;
  email: string | null;
  website: string | null;
  contact: string | null;
  rate: number | null;
  gstPercent: number | null;
  poNo: string | null;
  poDate: string | null;
  grnNos: string[];
  projectNo: string | null;
  qtyReceived: number;
  qtyBalance: number;
};

export type InventoryRow = {
  component_id: string;
  component_no: string;
  name: string;
  uom: string | null;
  qty_on_hand: number;
  lot_count: number;
  stock_value: number | null;
  breakdown: BreakdownEntry[];
  /** Project(s) this component was actually consumed on — independent of the PO it was ordered against. */
  consumedProjects: { projectNo: string; qty: number }[];
};

const EXPORT_HEADERS = [
  "Sr.No.", "Material Description", "Received Qty", "Balance Stock", "Unit", "Rate", "Amount",
  "GST 18%", "Total Amount", "Vendor Name", "PO. No.", "PO Date", "GRN No.", "Project No.", "WIP on Project",
  "GST No.", "PAN", "Vendor Contact Details", "Vendor Mail ID", "official Website",
];

type Cell = string | number | null;

async function downloadInventoryExcel(rows: InventoryRow[]) {
  const aoa: Cell[][] = [EXPORT_HEADERS];
  let sr = 0;

  for (const r of rows) {
    sr += 1;
    // "WIP on Project" is a different axis from the PO/GRN breakdown — its
    // entries stay comma-joined in one cell (repeated on every breakdown row).
    const consumed = r.consumedProjects.length
      ? r.consumedProjects
          .map((c) => `${c.projectNo}: ${formatNumber(c.qty)}${r.uom ? ` ${r.uom}` : ""}`)
          .join(", ")
      : "—";

    const groups = r.breakdown.length > 0 ? r.breakdown : [null];
    for (const g of groups) {
      let received: Cell, balance: Cell, rate: Cell, amount: Cell, gst: Cell, total: Cell;
      let vendor: string, poNo: string, poDate: string, grn: string, project: string;
      let gstNo: string, pan: string, contact: string, email: string, website: string;

      if (!g) {
        received = 0;
        balance = r.qty_on_hand;
        rate = amount = gst = total = null;
        vendor = poNo = poDate = grn = project = gstNo = pan = contact = email = website = "—";
      } else {
        // Value the *received* qty, not the on-hand balance: consumed stock still
        // counts as purchased value until a dispatch step exists.
        const amt = g.rate !== null ? g.rate * g.qtyReceived : null;
        const gstAmt = amt !== null && g.gstPercent !== null ? amt * (g.gstPercent / 100) : null;
        received = g.qtyReceived;
        balance = g.qtyBalance;
        rate = g.rate;
        amount = amt;
        gst = gstAmt;
        total = amt !== null && gstAmt !== null ? amt + gstAmt : amt;
        vendor = g.vendorName;
        poNo = g.poNo ?? "—";
        poDate = g.poDate ? formatDate(g.poDate) : "—";
        grn = g.grnNos.length ? g.grnNos.join(", ") : "—";
        project = g.projectNo ?? "—";
        gstNo = g.gstNo ?? "—";
        pan = g.pan ?? "—";
        contact = g.contact ?? "—";
        email = g.email ?? "—";
        website = g.website ?? "—";
      }

      aoa.push([
        sr,
        `${r.component_no} — ${r.name}`,
        received,
        balance,
        r.uom ?? "—",
        rate,
        amount,
        gst,
        total,
        vendor,
        poNo,
        poDate,
        grn,
        project,
        consumed,
        gstNo,
        pan,
        contact,
        email,
        website,
      ]);
    }
  }

  const qty = "#,##0.###";
  const today = new Date().toISOString().slice(0, 10);
  await downloadSheet({
    aoa,
    filename: `Inventory-Export-${today}.xlsx`,
    sheetName: "Inventory",
    colWidths: EXPORT_HEADERS.map((h) =>
      h === "WIP on Project" ? 28 : h === "GRN No." ? 24 : 20,
    ),
    numberFormats: { 0: "0", 2: qty, 3: qty, 5: "#,##0.00", 6: "#,##0", 7: "#,##0", 8: "#,##0" },
  });
}

export function InventoryTable({ rows, loadExportRows, finance, canDownload }: {
  rows: InventoryRow[];
  /** Builds the export's rows on the server — only when Download is pressed. */
  loadExportRows: () => Promise<{ rows?: InventoryRow[]; error?: string }>;
  finance: boolean;
  canDownload: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const matches = (r: { component_no: string; name: string }) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return r.component_no.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
  };
  const filtered = rows.filter(matches);

  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">No stock on hand yet. Receive a GRN to create lots.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search component no. or name…" />
        <p className="text-sm text-muted-foreground">{filtered.length} of {rows.length}</p>
        {canDownload && <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            setExportError(null);
            try {
              const res = await loadExportRows();
              if (res.error || !res.rows) { setExportError(res.error ?? "Could not build the export."); return; }
              await downloadInventoryExcel(res.rows.filter(matches));
            } catch {
              setExportError("Could not build the export — try again.");
            } finally {
              setExporting(false);
            }
          }}
        >
          <FileSpreadsheet className="size-4" /> Download Excel
        </Button>}
      </div>
      {exportError && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</p>}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Component</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>UoM</TableHead>
              <TableHead>On hand</TableHead>
              <TableHead>Lots</TableHead>
              {finance && <TableHead>Value</TableHead>}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={finance ? 7 : 6} className="py-8 text-center text-muted-foreground">No matches.</TableCell></TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.component_id}>
                  <TableCell className="font-medium">{r.component_no}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-muted-foreground">{r.uom ?? "—"}</TableCell>
                  <TableCell>{formatNumber(r.qty_on_hand)}</TableCell>
                  <TableCell>{formatNumber(r.lot_count)}</TableCell>
                  {finance && <TableCell>{formatINR(r.stock_value ?? 0)}</TableCell>}
                  <TableCell className="text-right">
                    <Link
                      href={`/inventory/${r.component_id}`}
                      aria-label="View lots"
                      className={buttonVariants({ variant: "ghost", size: "icon" })}
                    >
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
          <Link key={r.component_id} href={`/inventory/${r.component_id}`} className="block">
            <MobileRowCard
              title={`${r.component_no} — ${r.name}`}
              subtitle={r.uom ?? undefined}
              fields={[
                { label: "On hand", value: formatNumber(r.qty_on_hand) },
                { label: "Lots", value: formatNumber(r.lot_count) },
                ...(finance ? [{ label: "Value", value: formatINR(r.stock_value ?? 0) }] : []),
              ]}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

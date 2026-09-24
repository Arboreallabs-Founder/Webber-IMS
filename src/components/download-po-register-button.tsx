"use client";

import * as React from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/utils";
import { downloadSheet } from "@/lib/xlsx-format";

export type PoLineEntry = {
  poNo: string;
  poDate: string | null;
  expectedDate: string | null;
  projectNo: string | null;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  rate: number | null;
  amount: number | null;
  receipts: { grnNo: string; date: string | null; qty: number }[];
  vendorName: string;
  vendorContact: string | null;
  vendorEmail: string | null;
  vendorPan: string | null;
  vendorGst: string | null;
  vendorWebsite: string | null;
};

export type PoRegisterRow = {
  componentNo: string;
  name: string;
  uom: string | null;
  lines: PoLineEntry[];
};

type Cell = string | number | null;

/** Multiple GRNs against the same PO line stay clubbed in one cell. */
function receiptsText(entry: PoLineEntry) {
  if (!entry.receipts.length) return "—";
  return entry.receipts
    .map((r) => `${r.grnNo} — ${formatDate(r.date)} — ${formatNumber(r.qty)}`)
    .join(", ");
}

async function downloadPoRegisterExcel(rows: PoRegisterRow[], finance: boolean) {
  // Rate / Amount sit right after "PO No." and are only included for roles that
  // can see financials.
  const headers = [
    "Sr. No.", "WPC", "Material Description", "UOM",
    "PO No.",
    ...(finance ? ["Rate", "Amount"] : []),
    "PO Date", "Expected Date", "Project No.", "Ordered Qty", "Received Qty", "Remaining Qty",
    "Receipts (GRN — Date — Qty)",
    "Vendor Name", "Vendor Contact No.", "Vendor Email", "Vendor PAN", "Vendor GST No.", "Vendor Website",
  ];
  const colWidths = [
    6, 16, 40, 8,
    16,
    ...(finance ? [14, 16] : []),
    14, 14, 22, 12, 12, 12, 42, 22, 16, 24, 16, 18, 24,
  ];

  // Per-PO-line cells (everything to the right of the repeated component columns).
  const lineCells = (e: PoLineEntry): Cell[] => [
    e.poNo,
    ...(finance ? [e.rate, e.amount] : []),
    formatDate(e.poDate),
    formatDate(e.expectedDate),
    e.projectNo ?? "—",
    e.orderedQty,
    e.receivedQty,
    e.remainingQty,
    receiptsText(e),
    e.vendorName,
    e.vendorContact ?? "—",
    e.vendorEmail ?? "—",
    e.vendorPan ?? "—",
    e.vendorGst ?? "—",
    e.vendorWebsite ?? "—",
  ];

  const aoa: Cell[][] = [headers];
  let sr = 0;

  for (const r of rows) {
    sr += 1;
    // "Sr. No." + component columns repeat on every one of the component's rows.
    const comp: Cell[] = [sr, r.componentNo, r.name, r.uom ?? "—"];

    if (r.lines.length === 0) {
      aoa.push([
        ...comp,
        "—",
        ...(finance ? ["—", "—"] : []),
        "—", "—", "—", null, null, null, "—", "—", "—", "—", "—", "—", "—",
      ]);
      continue;
    }
    for (const e of r.lines) {
      aoa.push([...comp, ...lineCells(e)]);
    }
  }

  const qty = "#,##0.###";
  const today = new Date().toISOString().slice(0, 10);
  await downloadSheet({
    aoa,
    filename: `PO-Register-${today}.xlsx`,
    sheetName: "PO Register",
    colWidths,
    numberFormats: finance
      ? { 0: "0", 5: '"₹"#,##0.00', 6: '"₹"#,##0', 10: qty, 11: qty, 12: qty }
      : { 0: "0", 8: qty, 9: qty, 10: qty },
  });
}

export function DownloadPoRegisterButton({
  rows,
  finance = false,
  className,
}: {
  rows: PoRegisterRow[];
  finance?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      loading={busy}
      disabled={rows.length === 0}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadPoRegisterExcel(rows, finance);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileSpreadsheet className="size-4" /> Download PO Register
    </Button>
  );
}

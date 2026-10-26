"use client";

import Link from "next/link";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { QrCode } from "@/components/qr-code";
import { formatDate } from "@/lib/utils";
import { updateFgStatus, type ActionResult } from "./actions";

type Fg = { id: string; serial_no: string; product_label: string; status: string; variant_text: string; created_at: string };
// "dispatched" is set only by dispatching from the project's Materials issued tab.
const STATUSES = ["in_production", "ready"];

export function FgManager({
  units,
  canWrite,
}: {
  units: Fg[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const filteredUnits = units.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return u.serial_no.toLowerCase().includes(q) || u.product_label.toLowerCase().includes(q);
  });

  async function run(action: (fd: FormData) => Promise<ActionResult>, fd: FormData, onOk?: () => void) {
    setBusy(true); setError(null);
    const res = await action(fd);
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    onOk?.(); router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search serial no. or product…" />
        <p className="text-sm text-muted-foreground">{filteredUnits.length} of {units.length}</p>
      </div>
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Serial (QR)</TableHead>
            <TableHead>QR</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredUnits.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{units.length === 0 ? "No finished goods yet." : "No matches."}</TableCell></TableRow>
          ) : (
            filteredUnits.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/finished-goods/${u.id}`} className="text-primary hover:underline">{u.serial_no}</Link>
                </TableCell>
                <TableCell><QrCode value={u.serial_no} size={48} /></TableCell>
                <TableCell className="font-medium">{u.product_label}</TableCell>
                <TableCell className="text-muted-foreground">{u.variant_text || "—"}</TableCell>
                <TableCell>
                  {canWrite && u.status !== "dispatched" ? (
                    <Select value={u.status} disabled={busy} className="max-w-[160px]"
                      onChange={(e) => { const fd = new FormData(); fd.set("id", u.id); fd.set("status", e.target.value); run(updateFgStatus, fd); }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  ) : u.status.replace("_", " ")}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

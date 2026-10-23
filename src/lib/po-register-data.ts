import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { PoRegisterRow, PoLineEntry } from "@/components/download-po-register-button";
import { readAll, readAllIn } from "@/lib/server/read-all";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;


/**
 * Component-wise register of every PO raised (excluding drafts and superseded
 * revisions): per component, the PO lines that ordered it, ordered / received /
 * remaining qty, the GRN receipts against each line, and the vendor's contact
 * details. Powers the "Download PO Register" button on the PO and GRN list pages.
 */
export async function getPoRegisterRows(supabase: SupabaseClient, finance: boolean): Promise<PoRegisterRow[]> {
  const pos = await readAll((f, t) =>
    supabase
      .from("purchase_orders")
      .select("id, po_no, po_date, vendor_id, status")
      .neq("status", "draft")
      .neq("status", "superseded")
      .order("id")
      .range(f, t),
  );

  const poById = new Map((pos ?? []).map((p) => [p.id, p]));
  const poIds = [...poById.keys()];
  if (poIds.length === 0) return [];

  const lines = await readAllIn(poIds, (chunk, f, t) =>
    supabase
      .from("po_lines")
      .select("id, po_id, component_id, project_id, qty_ordered, qty_received, rate, amount, expected_date")
      .in("po_id", chunk)
      .neq("line_status", "cancelled")
      .not("component_id", "is", null)
      .order("id")
      .range(f, t),
  );
  if (lines.length === 0) return [];

  const vendorIds = [...new Set((pos ?? []).map((p) => p.vendor_id).filter((v): v is string => !!v))];
  const vendors = await readAllIn(vendorIds, (chunk, f, t) =>
    supabase.from("vendors").select("id, name, contact, email, pan, gst_no, website").in("id", chunk)
      .order("id")
      .range(f, t),
  );
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const componentIds = [...new Set(lines.map((l) => l.component_id).filter((v): v is string => !!v))];
  const components = await readAllIn(componentIds, (chunk, f, t) =>
    supabase.from("components").select("id, component_no, name, uom").in("id", chunk)
      .order("id")
      .range(f, t),
  );
  const componentById = new Map(components.map((c) => [c.id, c]));

  const projectIds = [...new Set(lines.map((l) => l.project_id).filter((v): v is string => !!v))];
  const projects = await readAllIn(projectIds, (chunk, f, t) =>
    supabase.from("projects").select("id, project_no").in("id", chunk)
      .order("id")
      .range(f, t),
  );
  const projectNoById = new Map(projects.map((p) => [p.id, p.project_no]));

  const poLineIds = lines.map((l) => l.id);
  const grnLines = await readAllIn(poLineIds, (chunk, f, t) =>
    supabase.from("grn_lines").select("po_line_id, qty_received, grn_id").in("po_line_id", chunk)
      .order("id")
      .range(f, t),
  );

  const grnIds = [...new Set(grnLines.map((g) => g.grn_id).filter((v): v is string => !!v))];
  const grns = await readAllIn(grnIds, (chunk, f, t) =>
    supabase.from("grns").select("id, grn_no, received_at").in("id", chunk)
      .order("id")
      .range(f, t),
  );
  const grnById = new Map(grns.map((g) => [g.id, g]));

  // po_line_id -> receipts, date-sorted
  const receiptsByPoLine = new Map<string, { grnNo: string; date: string | null; qty: number }[]>();
  for (const gl of grnLines) {
    if (!gl.po_line_id) continue;
    const grn = grnById.get(gl.grn_id);
    if (!grn) continue;
    const arr = receiptsByPoLine.get(gl.po_line_id) ?? [];
    arr.push({ grnNo: grn.grn_no, date: grn.received_at, qty: Number(gl.qty_received ?? 0) });
    receiptsByPoLine.set(gl.po_line_id, arr);
  }
  for (const arr of receiptsByPoLine.values()) {
    arr.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }

  // component_id -> PO line entries
  const byComponent = new Map<string, PoLineEntry[]>();
  for (const pl of lines) {
    if (!pl.component_id) continue;
    const po = poById.get(pl.po_id);
    if (!po) continue;
    const v = po.vendor_id ? vendorById.get(po.vendor_id) : null;
    const orderedQty = Number(pl.qty_ordered ?? 0);
    const receivedQty = Number(pl.qty_received ?? 0);
    const entry: PoLineEntry = {
      poNo: po.po_no,
      poDate: po.po_date,
      expectedDate: pl.expected_date,
      projectNo: pl.project_id ? projectNoById.get(pl.project_id) ?? null : null,
      orderedQty,
      receivedQty,
      remainingQty: Math.max(orderedQty - receivedQty, 0),
      rate: !finance || pl.rate == null ? null : Number(pl.rate),
      amount: !finance || pl.amount == null ? null : Number(pl.amount),
      receipts: receiptsByPoLine.get(pl.id) ?? [],
      vendorName: v?.name ?? "—",
      vendorContact: v?.contact ?? null,
      vendorEmail: v?.email ?? null,
      vendorPan: v?.pan ?? null,
      vendorGst: v?.gst_no ?? null,
      vendorWebsite: v?.website ?? null,
    };
    const list = byComponent.get(pl.component_id) ?? [];
    list.push(entry);
    byComponent.set(pl.component_id, list);
  }

  return [...byComponent.entries()]
    .map(([cid, entries]) => {
      const c = componentById.get(cid);
      return {
        componentNo: c?.component_no ?? "—",
        name: c?.name ?? "—",
        uom: c?.uom ?? null,
        lines: entries.sort((a, b) => a.poNo.localeCompare(b.poNo)),
      };
    })
    .sort((a, b) => a.componentNo.localeCompare(b.componentNo));
}

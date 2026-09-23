import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { DocumentSignatureBlock } from "@/components/document-signature-block";
import { getSigningState } from "@/lib/signatures";
import { formatNumber } from "@/lib/utils";

// ---- MRIN form's own fixed header block (distinct from the PO print's OUR block) ----
const MRIN_OUR = {
  tagline: "[Add company tagline]",
  address: "[Add company address]",
  formatNo: "WEC/MRIN/001",
  rev: "Rev.00",
  formDate: "28.07.2026",
};

function formatDateDDMMYYYY(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB").replace(/\//g, ".");
}

function itemDescription(c: { component_no: string; name: string } | undefined): string {
  if (!c) return "—";
  return `${c.component_no} — ${c.name}`;
}

function specGrade(c: { spec: string | null; grade: string | null } | undefined): string {
  if (!c) return "—";
  return [c.spec, c.grade].filter(Boolean).join(" / ") || "—";
}

function sizeLabel(
  c: { nominal_size: string | null; od_mm: number | null; id_mm: number | null; thk_mm: number | null; width_mm: number | null; length_mm: number | null } | undefined,
): string {
  if (!c) return "—";
  if (c.nominal_size) return c.nominal_size;
  const parts: string[] = [];
  if (c.od_mm) parts.push(`OD ${c.od_mm}`);
  if (c.id_mm) parts.push(`ID ${c.id_mm}`);
  if (c.thk_mm) parts.push(`THK ${c.thk_mm}`);
  if (c.width_mm) parts.push(`W ${c.width_mm}`);
  if (c.length_mm) parts.push(`L ${c.length_mm}`);
  return parts.length ? parts.join(" x ") : "—";
}

export default async function GrnPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: grnId } = await params;
  const supabase = await createClient();

  const { data: grn } = await supabase.from("grns").select("*").eq("id", grnId).single();
  if (!grn) notFound();

  const signingState = await getSigningState("grn", grnId, grn.created_by, null, grn.created_at);
  if (!signingState.printable) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-amber-700">Cannot print this GRN</p>
        <p className="mt-2 text-sm text-muted-foreground">
          It still needs {signingState.requiredSlots.length - signingState.signed.length} signature(s) before it can be printed.
        </p>
        <Link href={`/grn/${grnId}`} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to GRN
        </Link>
      </div>
    );
  }

  const [{ data: vendor }, { data: grnLines }] = await Promise.all([
    grn.vendor_id ? supabase.from("vendors").select("name").eq("id", grn.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("grn_lines").select("id, component_id, po_line_id, jw_line_id, qty_received").eq("grn_id", grnId).order("created_at"),
  ]);

  const jwLineIds = [...new Set((grnLines ?? []).map((l) => l.jw_line_id).filter(Boolean))] as string[];
  const { data: jwLines } = jwLineIds.length
    ? await supabase.from("job_work_lines").select("id, job_work_orders(jw_no)").in("id", jwLineIds)
    : { data: [] };
  const jwNos = [...new Set((jwLines ?? []).map((l) => (l.job_work_orders as unknown as { jw_no: string } | null)?.jw_no).filter(Boolean))] as string[];

  const componentIds = [...new Set((grnLines ?? []).map((l) => l.component_id).filter(Boolean))] as string[];
  const poLineIds = [...new Set((grnLines ?? []).map((l) => l.po_line_id).filter(Boolean))] as string[];
  const grnLineIds = (grnLines ?? []).map((l) => l.id);
  const [{ data: components }, { data: poLines }, { data: irns }] = await Promise.all([
    componentIds.length
      ? supabase.from("components").select("id, component_no, name, uom, spec, grade, nominal_size, od_mm, id_mm, thk_mm, width_mm, length_mm, inspection_template_id").in("id", componentIds)
      : Promise.resolve({ data: [] }),
    poLineIds.length ? supabase.from("po_lines").select("id, po_id, qty_ordered, purchase_orders(po_no)") .in("id", poLineIds) : Promise.resolve({ data: [] }),
    grnLineIds.length ? supabase.from("irns").select("id, grn_line_id, approval_remarks").in("grn_line_id", grnLineIds) : Promise.resolve({ data: [] }),
  ]);
  const compById = new Map((components ?? []).map((c) => [c.id, c]));
  const poLineById = new Map((poLines ?? []).map((p) => [p.id, p]));
  const irnByGrnLine = new Map((irns ?? []).map((i) => [i.grn_line_id, i]));
  const poNos = [...new Set((poLines ?? []).map((p) => (p.purchase_orders as unknown as { po_no: string } | null)?.po_no).filter(Boolean))] as string[];

  // Checklist columns are merged by (label, field_type) across every template
  // actually used by this GRN's lines — not tied to one hardcoded template.
  // Two templates' fields with the same label+type share one printed column;
  // each line's own answer is still looked up via its own template's real
  // field id (fieldIdByTemplate), so answers never cross-match by accident.
  const templateIds = [...new Set((components ?? []).map((c) => c.inspection_template_id).filter((v): v is string => !!v))];
  const { data: templateFields } = templateIds.length
    ? await supabase
        .from("inspection_template_fields")
        .select("id, template_id, label, field_type, sort_order")
        .in("template_id", templateIds)
        .eq("is_active", true)
        .eq("show_on_printout", true)
    : { data: [] };

  type Column = { label: string; field_type: string; sortOrder: number; fieldIdByTemplate: Map<string, string> };
  const columnsByKey = new Map<string, Column>();
  for (const f of templateFields ?? []) {
    const key = `${f.label}::${f.field_type}`;
    let col = columnsByKey.get(key);
    if (!col) {
      col = { label: f.label, field_type: f.field_type, sortOrder: f.sort_order, fieldIdByTemplate: new Map() };
      columnsByKey.set(key, col);
    }
    col.sortOrder = Math.min(col.sortOrder, f.sort_order);
    col.fieldIdByTemplate.set(f.template_id, f.id);
  }
  const fields = [...columnsByKey.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  const irnIds = (irns ?? []).map((i) => i.id);
  const { data: answers } = irnIds.length
    ? await supabase.from("irn_answers").select("irn_id, field_id, text_value, choice_value").in("irn_id", irnIds)
    : { data: [] };
  const answersByIrn = new Map<string, Map<string, { text_value: string | null; choice_value: string | null }>>();
  for (const a of answers ?? []) {
    if (!answersByIrn.has(a.irn_id)) answersByIrn.set(a.irn_id, new Map());
    answersByIrn.get(a.irn_id)!.set(a.field_id, { text_value: a.text_value, choice_value: a.choice_value });
  }

  const lineRows = (grnLines ?? []).map((gl, i) => {
    const c = gl.component_id ? compById.get(gl.component_id) : undefined;
    const pl = gl.po_line_id ? poLineById.get(gl.po_line_id) : undefined;
    const irn = irnByGrnLine.get(gl.id);
    const irnAnswers = irn ? answersByIrn.get(irn.id) : undefined;
    return {
      sr: i + 1,
      item: itemDescription(c),
      specGrade: specGrade(c),
      size: sizeLabel(c),
      unit: c?.uom ?? "—",
      poQty: pl?.qty_ordered ?? null,
      receivedQty: gl.qty_received,
      checklist: fields.map((f) => {
        const templateId = c?.inspection_template_id;
        const fieldId = templateId ? f.fieldIdByTemplate.get(templateId) : undefined;
        const a = fieldId ? irnAnswers?.get(fieldId) : undefined;
        if (!a) return { value: "—", isLink: false };
        if (f.field_type === "checkbox") {
          return { value: a.choice_value === "true" ? "✓" : a.choice_value === "false" ? "✗" : "—", isLink: false };
        }
        const value = a.text_value || a.choice_value || "—";
        return { value, isLink: f.field_type === "link" && value !== "—" };
      }),
      remarks: irn?.approval_remarks?.trim() || null,
    };
  });

  const remarkRows = lineRows.filter((l) => l.remarks);
  const totalCols = 7 + fields.length;

  return (
    <div className="mx-auto max-w-6xl bg-white p-6 text-black print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/grn/${grnId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to GRN
        </Link>
        <PrintButton label="Print MRIN" />
      </div>

      {/* Company header + GRN info. print:fixed so it's re-emitted on every physical printed
          page (this app's <thead> repeat-on-page-break never worked here — tried plain
          markup, no flex/grid, inline border-collapse override, prod build, nothing repeated
          it — position:fixed is the one mechanism that reliably does). */}
      <div className="border border-black text-[10px] leading-tight print:fixed print:inset-x-0 print:top-0 print:z-10 print:border-0 print:bg-white">
        <div className="flex items-start justify-between border-b border-black p-3">
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/webber-masthead.png" alt="Webber Electro Corp" className="h-10 w-auto object-contain" />
            <div>
              <p className="mt-0.5 max-w-md text-[9px]">{MRIN_OUR.tagline}</p>
              <p className="text-[9px]">{MRIN_OUR.address}</p>
            </div>
          </div>
          <div className="whitespace-nowrap text-right text-[9px] leading-snug">
            <p>Format No.: {MRIN_OUR.formatNo}</p>
            <p>{MRIN_OUR.rev}</p>
            <p>Date : {MRIN_OUR.formDate}</p>
          </div>
        </div>
        <h1 className="border-b border-black py-2 text-center text-base font-bold">MATERIAL RECEIPT CUM INSPECTION NOTE (MRIN)</h1>
        <div className="grid grid-cols-4 divide-x divide-black border-b border-black">
          <div className="p-2"><span className="font-semibold">GRN No.:</span> {grn.grn_no}</div>
          <div className="p-2"><span className="font-semibold">Vendor:</span> {vendor?.name ?? "—"}</div>
          <div className="p-2"><span className="font-semibold">Date:</span> {formatDateDDMMYYYY(grn.received_at)}</div>
          <div className="p-2">
            <span className="font-semibold">{grn.is_job_work ? "JW No.:" : "PO No.:"}</span> {grn.is_job_work ? (jwNos.length ? jwNos.join(", ") : "—") : poNos.length ? poNos.join(", ") : "—"}
          </div>
          <div className="p-2"><span className="font-semibold">Challan No.:</span> {grn.challan_no ?? "—"}</div>
          <div className="p-2"><span className="font-semibold">Invoice No.:</span> {grn.invoice_no ?? "—"}</div>
        </div>
      </div>

      {/* print:pt clears the fixed header above on every page. The column-label row below
          still only prints on page 1 (thead repeat doesn't work — see note above), so a
          multi-page GRN's later pages show data without repeated column labels. */}
      <div className="border border-black text-[10px] leading-tight print:pt-[66mm]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="border-r border-black p-1 text-left">Sr.</th>
              <th className="border-r border-black p-1 text-left">Item Description</th>
              <th className="border-r border-black p-1 text-left">Spec &amp; Grade</th>
              <th className="border-r border-black p-1 text-left">Size</th>
              <th className="border-r border-black p-1 text-left">Unit</th>
              <th className="border-r border-black p-1 text-right">PO Qty</th>
              <th className="border-r border-black p-1 text-right">Received</th>
              {fields.map((f) => (
                <th key={`${f.label}::${f.field_type}`} className="border-r border-black p-1 text-center">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lineRows.length === 0 ? (
              <tr><td colSpan={totalCols} className="p-3 text-center text-muted-foreground">No lines.</td></tr>
            ) : (
              lineRows.map((l) => (
                <tr key={l.sr} className="border-b border-black/20">
                  <td className="border-r border-black/20 p-1">{l.sr}</td>
                  <td className="border-r border-black/20 p-1">{l.item}</td>
                  <td className="border-r border-black/20 p-1">{l.specGrade}</td>
                  <td className="border-r border-black/20 p-1">{l.size}</td>
                  <td className="border-r border-black/20 p-1">{l.unit}</td>
                  <td className="border-r border-black/20 p-1 text-right">{l.poQty !== null ? formatNumber(l.poQty) : "—"}</td>
                  <td className="border-r border-black/20 p-1 text-right">{formatNumber(l.receivedQty)}</td>
                  {l.checklist.map((c, idx) => (
                    <td key={idx} className="border-r border-black/20 p-1 text-center">
                      {c.isLink ? (
                        <a href={c.value} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                          {c.value}
                        </a>
                      ) : (
                        c.value
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Remarks — captured by the approver at IRN approval time; blank if none were left. */}
        <div className="min-h-[25mm] break-inside-avoid border-b border-black p-3">
          <p className="mb-1 font-semibold">Remarks:</p>
          {remarkRows.length > 0 && (
            <div className="space-y-0.5">
              {remarkRows.map((l) => (
                <p key={l.sr}>{remarkRows.length > 1 ? `${l.item}: ` : ""}{l.remarks}</p>
              ))}
            </div>
          )}
        </div>

        {/* Signatures — one block per GRN, appears once at the end of the document */}
        <DocumentSignatureBlock
          labels={["Prepared By (Store)", "Inspected By (QA/QC)", "Approved By"]}
          signed={signingState.signed}
          requiredSlots={signingState.requiredSlots}
          className="break-inside-avoid"
        />
      </div>
    </div>
  );
}

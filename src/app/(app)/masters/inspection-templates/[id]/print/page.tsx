import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { DocumentSignatureBlock } from "@/components/document-signature-block";
import { MrinHeader } from "@/components/mrin-header";
import { requirePathAccess } from "@/lib/auth";

const BLANK_ROWS = 8;

type Field = {
  id: string;
  label: string;
  sort_order: number;
};

export default async function InspectionTemplatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/masters");
  const { id } = await params;
  const supabase = await createClient();

  const { data: template } = await supabase.from("inspection_templates").select("*").eq("id", id).single();
  if (!template) notFound();

  const { data: fieldsRaw } = await supabase
    .from("inspection_template_fields")
    .select("id, label, sort_order, is_active, show_on_printout")
    .eq("template_id", id)
    .eq("is_active", true)
    .eq("show_on_printout", true)
    .order("sort_order");

  const fields = ((fieldsRaw ?? []) as (Field & { is_active: boolean; show_on_printout: boolean })[]).sort((a, b) => a.sort_order - b.sort_order);
  const totalCols = 7 + fields.length;

  return (
    <div className="mx-auto max-w-6xl bg-white p-6 text-black print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/masters/inspection-templates/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to template
        </Link>
        <PrintButton label="Print blank preview" />
      </div>

      <MrinHeader
        title="MATERIAL RECEIPT CUM INSPECTION NOTE (MRIN)"
        fields={[
          { label: "GRN No.", value: "______________" },
          { label: "Vendor", value: "______________" },
          { label: "Date", value: "______________" },
          { label: "PO No.", value: "______________" },
          { label: "Challan No.", value: "______________" },
          { label: "Invoice No.", value: "______________" },
        ]}
      />

      <div className="border border-black text-[10px] leading-tight">
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
                <th key={f.id} className="border-r border-black p-1 text-center">{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: BLANK_ROWS }).map((_, i) => (
              <tr key={i} className="border-b border-black/20">
                <td className="border-r border-black/20 p-2">{i + 1}</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                <td className="border-r border-black/20 p-2">&nbsp;</td>
                {fields.map((f) => (
                  <td key={f.id} className="border-r border-black/20 p-2">&nbsp;</td>
                ))}
              </tr>
            ))}
            {fields.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="border-t border-black/20 p-2 text-center text-muted-foreground">
                  No checklist fields defined for this template.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="min-h-[25mm] break-inside-avoid border-b border-black p-3">
          <p className="mb-1 font-semibold">Remarks:</p>
        </div>

        <DocumentSignatureBlock
          labels={["Prepared By (Store)", "Inspected By (QA/QC)", "Approved By"]}
          signed={[]}
          requiredSlots={[1, 2, 3]}
          className="break-inside-avoid"
        />
      </div>
    </div>
  );
}

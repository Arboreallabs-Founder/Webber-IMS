import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { DocumentSignatureBlock } from "@/components/document-signature-block";
import { getSigningState } from "@/lib/signatures";
import { formatNumber } from "@/lib/utils";

// ---- our company's fixed details — update with Webber Electro Corp's real info ----
const OUR = {
  billingName: "Webber Electro Corp",
  billingAddress: ["[Add company address]"],
  contactName: "[Add contact name]",
  contactMob: "[Add contact number]",
  contactEmail: "[Add contact email]",
  gstin: "[Add GSTIN]",
  pan: "[Add PAN]",
  headOffice: "Head Office : [Add address]",
  deliveryAddress: [
    "Webber Electro Corp",
    "[Add company address]",
  ],
};

const TERMS = [
  "This material remains the property of WEBBER ELECTRO CORP and is issued strictly for job-work processing.",
  "Please mention our JW no. on your delivery challan & invoice for the processed material returned.",
  "The returned material should be labelled with the JW No. and quantity for reconciliation against this challan.",
  "Any loss, damage or shortfall in the material during job-work must be reported immediately.",
  "Job-work rates are firm and final for this order; no escalation or increase will be entertained.",
  "Billing for job-work charges is to be raised only on the quantity actually received back.",
];

function formatDateDDMMYYYY(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB").replace(/\//g, ".");
}

export default async function JwPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: order } = await supabase.from("job_work_orders").select("*").eq("id", id).single();
  if (!order) notFound();
  const signingState = await getSigningState("job_work", id, order.created_by, profile?.id ?? null);

  if (!signingState.fullySigned) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-amber-700">Cannot print this job-work order</p>
        <p className="mt-2 text-sm text-muted-foreground">
          It still needs {signingState.requiredSlots.length - signingState.signed.length} signature(s) before it can be printed.
        </p>
        <Link href={`/job-work/${id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to job-work order
        </Link>
      </div>
    );
  }

  // Admin/team_lead (the roles that manage job-work) can browse every revision in this order's lineage from here.
  const canViewRevisions = profile?.role === "admin" || profile?.role === "team_lead";
  const rootId = order.root_jw_id ?? order.id;
  const { data: lineage } = canViewRevisions
    ? await supabase.from("job_work_orders").select("id, jw_no, revision_no").or(`id.eq.${rootId},root_jw_id.eq.${rootId}`).order("revision_no")
    : { data: null };

  const [{ data: lines }, { data: vendor }] = await Promise.all([
    supabase.from("job_work_lines").select("component_id, raw_lot_id, qty_sent, jw_rate").eq("jw_order_id", id).order("created_at"),
    order.vendor_id ? supabase.from("vendors").select("name, address, contact, gst_no").eq("id", order.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const componentIds = [...new Set((lines ?? []).map((l) => l.component_id).filter(Boolean))] as string[];
  const rawLotIds = [...new Set((lines ?? []).map((l) => l.raw_lot_id).filter(Boolean))] as string[];
  const [{ data: components }, { data: rawLots }, project] = await Promise.all([
    componentIds.length ? supabase.from("components").select("id, component_no, name, uom, jw_rate").in("id", componentIds) : Promise.resolve({ data: [] }),
    rawLotIds.length ? supabase.from("inventory_lots").select("id, lot_code").in("id", rawLotIds) : Promise.resolve({ data: [] }),
    order.project_id
      ? supabase.from("projects").select("project_no").eq("id", order.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const compById = new Map((components ?? []).map((c) => [c.id, c]));
  const lotById = new Map((rawLots ?? []).map((l) => [l.id, l]));

  // Customer identity is deliberately withheld from the job-work vendor —
  // only our own project reference is shown, never the customer's name.
  const projectDisplay = project.data?.project_no ?? "Stock";

  const lineRows = (lines ?? []).map((l, i) => {
    const c = l.component_id ? compById.get(l.component_id) : null;
    const rate = Number(l.jw_rate ?? c?.jw_rate ?? 0);
    const qty = Number(l.qty_sent ?? 0);
    return {
      sr: i + 1,
      item: c ? `${c.component_no} — ${c.name}` : "—",
      rawLot: l.raw_lot_id ? lotById.get(l.raw_lot_id)?.lot_code ?? "—" : "—",
      uom: c?.uom ?? "",
      qty,
      rate,
      amount: rate * qty,
    };
  });
  const subtotal = lineRows.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/job-work/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to JW
        </Link>
        <PrintButton label="Print JW" />
      </div>

      {lineage && lineage.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
          <span className="text-xs font-medium text-muted-foreground">Versions:</span>
          {lineage.map((r) => (
            <Link
              key={r.id}
              href={`/job-work/${r.id}/print`}
              className={`rounded-md border px-2 py-1 text-xs ${r.id === id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {r.revision_no === 0 ? "Original" : `R${r.revision_no}`}
            </Link>
          ))}
        </div>
      )}

      {order.superseded_by && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
          Superseded revision — not the current version of this job-work order
        </p>
      )}

      <div className="border border-black text-[11px] leading-tight">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black p-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/webber-masthead.png" alt="Webber Electro Corp" className="h-12 w-auto object-contain" />
            <div>
              <p className="text-[10px]">{OUR.headOffice}</p>
            </div>
          </div>
          <div className="text-right text-[10px] leading-snug">
            <p className="font-semibold">[Add company tagline]</p>
          </div>
        </div>

        <h1 className="border-b border-black py-2 text-center text-lg font-bold">JOB WORK ORDER</h1>

        {/* Date / JW No / Project */}
        <div className="flex justify-between border-b border-black p-3">
          <p>JW DATE : {formatDateDDMMYYYY(order.sent_date)}</p>
          <div className="text-right">
            <p>JW NO : {order.jw_no}</p>
            <p>Project : {projectDisplay}</p>
          </div>
        </div>

        {/* Vendor / Billing */}
        <div className="grid grid-cols-2 gap-3 border-b border-black p-3">
          <div>
            <p className="mb-1 font-bold">JOB-WORK VENDOR NAME &amp; ADDRESS :</p>
            <p className="font-medium">{vendor?.name ?? "—"}</p>
            {vendor?.address
              ? vendor.address.split("\n").map((l: string, i: number) => <p key={i}>{l}</p>)
              : <p className="italic text-muted-foreground">(no address on file — Masters → Vendors)</p>}
            {vendor?.contact && <p className="mt-2">{vendor.contact}</p>}
          </div>
          <div>
            <p className="mb-1 font-bold">BILLING NAME &amp; ADDRESS :</p>
            <p className="font-medium">{OUR.billingName}</p>
            {OUR.billingAddress.map((l) => <p key={l}>{l}</p>)}
            <p className="mt-2">{OUR.contactName}</p>
            <p>MOB.:{OUR.contactMob}</p>
            <p>Email: {OUR.contactEmail}</p>
          </div>
        </div>

        <p className="border-b border-black p-3">
          We are sending the following material for job-work processing on the terms and conditions mentioned below :-
        </p>

        {/* Line items */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="border-r border-black p-1.5 text-left">Sr. No.</th>
              <th className="border-r border-black p-1.5 text-left">ITEM</th>
              <th className="border-r border-black p-1.5 text-left">Raw Lot</th>
              <th className="border-r border-black p-1.5 text-right">Qty Sent</th>
              <th className="border-r border-black p-1.5 text-left">UOM</th>
              <th className="border-r border-black p-1.5 text-right">Rate</th>
              <th className="p-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lineRows.length === 0 ? (
              <tr><td colSpan={7} className="p-3 text-center text-muted-foreground">No lines.</td></tr>
            ) : (
              lineRows.map((l) => (
                <tr key={l.sr} className="border-b border-black/20">
                  <td className="border-r border-black/20 p-1.5">{l.sr}</td>
                  <td className="border-r border-black/20 p-1.5">{l.item}</td>
                  <td className="border-r border-black/20 p-1.5">{l.rawLot}</td>
                  <td className="border-r border-black/20 p-1.5 text-right">{formatNumber(l.qty)}</td>
                  <td className="border-r border-black/20 p-1.5">{l.uom}</td>
                  <td className="border-r border-black/20 p-1.5 text-right">{l.rate ? formatNumber(l.rate) : "—"}</td>
                  <td className="p-1.5 text-right">{formatNumber(l.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="grid grid-cols-2 border-t border-black">
          <div className="border-r border-black p-3">
            <p>GSTIN : {OUR.gstin}</p>
            <p>PAN : {OUR.pan}</p>
            <p>Job-work charges — taxes as applicable</p>
          </div>
          <div className="p-3">
            <div className="flex justify-between border-t border-black font-bold"><span>TOTAL (est.)</span><span>Rs {formatNumber(subtotal)}</span></div>
          </div>
        </div>

        {/* Terms & Condition */}
        <div className="border-t border-black p-3">
          <p className="mb-1 font-bold">TERMS &amp; CONDITION:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            {TERMS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </div>

        {/* Return address + dispatch details */}
        <div className="grid grid-cols-2 gap-3 border-t border-black p-3">
          <div>
            <p className="mb-1 font-bold">Return Processed Material To :</p>
            {OUR.deliveryAddress.map((l) => <p key={l}>{l}</p>)}
          </div>
          <div>
            <p className="mb-1 font-bold">Dispatch Details:</p>
            <p>Sent Date : {formatDateDDMMYYYY(order.sent_date)}</p>
            <p>Expected Return : {formatDateDDMMYYYY(order.expected_date)}</p>
            <p>Status : {order.status}</p>
          </div>
        </div>

        {/* Signatures */}
        <DocumentSignatureBlock labels={["PREPARED BY", "VERIFIED BY", "APPROVED BY"]} signed={signingState.signed} requiredSlots={signingState.requiredSlots} />
      </div>
    </div>
  );
}

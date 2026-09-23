import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PrintButton } from "@/components/print-button";
import { DocumentSignatureBlock } from "@/components/document-signature-block";
import { getSigningState } from "@/lib/signatures";
import { formatNumber } from "@/lib/utils";
import { DownloadExcelButton } from "./download-excel-button";

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
  "The material is accepted subject to inspection. Please mention our PO no. on your delivery challan & Invoice.",
  "The material should be labelled with it's grade, Batch/Lot No., MFG/Expiry date.",
  "The MTC (Material Test Certificate) should be sent along with the supply.",
  "The failure due to poor work man ship or any other defect shall be replace free of cost with in the warranty period.",
  "PO price are firm and final till the exection of contract, no escalation or reqest in increase the price will be entertain.",
  "The seller shall be liable to pay to buyer LD, a sum equivalent to 0.5% of the Ex work contract value for each week of delay or any part thereof. However, total amount of LD for delay in completion of contract shall be subject to a maximum of 5% fo Ex work contract price.",
];

function formatDateDDMMYYYY(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB").replace(/\//g, ".");
}

export default async function PoPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unpriced?: string }>;
}) {
  const { id } = await params;
  const { unpriced: unpricedParam } = await searchParams;
  const unpriced = unpricedParam === "1";
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: po } = await supabase.from("purchase_orders").select("*").eq("id", id).single();
  if (!po) notFound();
  const signingState = await getSigningState("po", id, po.created_by, profile?.id ?? null);

  // Admin/Founder can browse every revision in this PO's lineage from here.
  const canViewRevisions = profile?.role === "admin" || profile?.role === "founder";
  const rootId = po.root_po_id ?? po.id;
  const { data: lineage } = canViewRevisions
    ? await supabase.from("purchase_orders").select("id, po_no, revision_no").or(`id.eq.${rootId},root_po_id.eq.${rootId}`).order("revision_no")
    : { data: null };

  const [{ data: lines }, { data: vendor }] = await Promise.all([
    supabase.from("po_lines").select("component_id, project_id, qty_ordered, rate, amount, approval_status").eq("po_id", id).order("created_at"),
    po.vendor_id ? supabase.from("vendors").select("name, address, contact, gst_no").eq("id", po.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const pendingCount = (lines ?? []).filter((l) => l.approval_status !== "approved").length;
  if (pendingCount > 0) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-amber-700">Cannot print this PO</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {pendingCount} line(s) are awaiting price approval. Printing is blocked until every line is approved.
        </p>
        <Link href={`/purchase-orders/${id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to PO
        </Link>
      </div>
    );
  }

  if (!signingState.fullySigned) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-lg font-semibold text-amber-700">Cannot print this PO</p>
        <p className="mt-2 text-sm text-muted-foreground">
          It still needs {signingState.requiredSlots.length - signingState.signed.length} signature(s) before it can be printed.
        </p>
        <Link href={`/purchase-orders/${id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="size-4" /> Back to PO
        </Link>
      </div>
    );
  }

  const componentIds = [...new Set((lines ?? []).map((l) => l.component_id).filter(Boolean))] as string[];
  const projectIds = [...new Set((lines ?? []).map((l) => l.project_id).filter(Boolean))] as string[];
  const [{ data: components }, { data: projects }] = await Promise.all([
    componentIds.length ? supabase.from("components").select("id, component_no, name, uom").in("id", componentIds) : Promise.resolve({ data: [] }),
    projectIds.length ? supabase.from("projects").select("id, project_no").in("id", projectIds) : Promise.resolve({ data: [] }),
  ]);
  const compById = new Map((components ?? []).map((c) => [c.id, c]));
  const projectLabel = projectIds.length
    ? (projects ?? []).map((p) => p.project_no).join(", ")
    : "Stock";

  const lineRows = (lines ?? []).map((l, i) => {
    const c = l.component_id ? compById.get(l.component_id) : null;
    return {
      sr: i + 1,
      item: c ? `${c.component_no} — ${c.name}` : "—",
      uom: c?.uom ?? "",
      qty: Number(l.qty_ordered ?? 0),
      rate: Number(l.rate ?? 0),
      amount: Number(l.amount ?? (l.rate ?? 0) * Number(l.qty_ordered ?? 0)),
    };
  });
  const subtotal = lineRows.reduce((s, l) => s + l.amount, 0);
  const gstPct = Number(po.gst_percent ?? 18);
  const gstAmount = (subtotal * gstPct) / 100;
  const total = subtotal + gstAmount;
  const deliveryAddressLines: string[] = po.delivery_address?.trim() ? po.delivery_address.split(/\r?\n/) : OUR.deliveryAddress;

  return (
    <div className="mx-auto max-w-4xl bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/purchase-orders/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to PO
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={unpriced ? `/purchase-orders/${id}/print` : `/purchase-orders/${id}/print?unpriced=1`}
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            {unpriced ? "View priced version" : "View unpriced version"}
          </Link>
          {!unpriced && (
            <DownloadExcelButton
              poNo={po.po_no}
              poDate={formatDateDDMMYYYY(po.po_date)}
              vendor={vendor}
              projectLabel={projectLabel}
              deliveryAddressLines={deliveryAddressLines}
              deliveryTerms={po.delivery_terms}
              paymentTerms={po.payment_terms}
              freightTerms={po.freight_terms}
              our={{ billingName: OUR.billingName, billingAddress: OUR.billingAddress, gstin: OUR.gstin, pan: OUR.pan }}
              lineRows={lineRows}
              subtotal={subtotal}
              gstPct={gstPct}
              gstAmount={gstAmount}
              total={total}
            />
          )}
          <PrintButton label="Print PO" />
        </div>
      </div>

      {lineage && lineage.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden">
          <span className="text-xs font-medium text-muted-foreground">Versions:</span>
          {lineage.map((r) => (
            <Link
              key={r.id}
              href={`/purchase-orders/${r.id}/print`}
              className={`rounded-md border px-2 py-1 text-xs ${r.id === id ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"}`}
            >
              {r.revision_no === 0 ? "Original" : `R${r.revision_no}`}
            </Link>
          ))}
        </div>
      )}

      {po.superseded_by && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
          Superseded revision — not the current version of this PO
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

        <h1 className="border-b border-black py-2 text-center text-lg font-bold">
          PURCHASE ORDER{unpriced ? " — UNPRICED COPY" : ""}
        </h1>

        {/* Date / PO No / Project */}
        <div className="flex justify-between border-b border-black p-3">
          <p>PO DATE : {formatDateDDMMYYYY(po.po_date)}</p>
          <div className="text-right">
            <p>PO NO : {po.po_no}</p>
            <p>Project : {projectLabel}</p>
          </div>
        </div>

        {/* Vendor / Billing */}
        <div className="grid grid-cols-2 gap-3 border-b border-black p-3">
          <div>
            <p className="mb-1 font-bold">VENDOR NAME &amp; ADDRESS :</p>
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
          We are pleased to place an order for the supply of following items on the terms and conditions mentioned below :-
        </p>

        {/* Line items */}
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="border-r border-black p-1.5 text-left">Sr. No.</th>
              <th className="border-r border-black p-1.5 text-left">ITEM</th>
              <th className="border-r border-black p-1.5 text-right">Qty.</th>
              <th className={unpriced ? "p-1.5 text-left" : "border-r border-black p-1.5 text-left"}>UOM</th>
              {!unpriced && <th className="border-r border-black p-1.5 text-right">Rate</th>}
              {!unpriced && <th className="p-1.5 text-right">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {lineRows.length === 0 ? (
              <tr><td colSpan={unpriced ? 4 : 6} className="p-3 text-center text-muted-foreground">No lines.</td></tr>
            ) : (
              lineRows.map((l) => (
                <tr key={l.sr} className="border-b border-black/20">
                  <td className="border-r border-black/20 p-1.5">{l.sr}</td>
                  <td className="border-r border-black/20 p-1.5">{l.item}</td>
                  <td className="border-r border-black/20 p-1.5 text-right">{formatNumber(l.qty)}</td>
                  <td className={unpriced ? "p-1.5" : "border-r border-black/20 p-1.5"}>{l.uom}</td>
                  {!unpriced && <td className="border-r border-black/20 p-1.5 text-right">{l.rate ? formatNumber(l.rate) : "—"}</td>}
                  {!unpriced && <td className="p-1.5 text-right">{formatNumber(l.amount)}</td>}
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals */}
        {!unpriced && (
          <div className="grid grid-cols-2 border-t border-black">
            <div className="border-r border-black p-3">
              <p>GSTIN : {OUR.gstin}</p>
              <p>PAN : {OUR.pan}</p>
              <p>Taxes as applicable - At Actual</p>
            </div>
            <div className="p-3">
              <div className="flex justify-between"><span>SUBTOTAL</span><span>Rs {formatNumber(subtotal)}</span></div>
              <div className="flex justify-between"><span>GST {formatNumber(gstPct)}%</span><span>{formatNumber(gstAmount)}</span></div>
              <div className="flex justify-between border-t border-black font-bold"><span>TOTAL</span><span>Rs {formatNumber(total)}</span></div>
            </div>
          </div>
        )}

        {/* Terms & Condition */}
        <div className="border-t border-black p-3">
          <p className="mb-1 font-bold">TERMS &amp; CONDITION:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            {TERMS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        </div>

        {/* Delivery address + terms */}
        <div className="grid grid-cols-2 gap-3 border-t border-black p-3">
          <div>
            <p className="mb-1 font-bold">Delivery Address :</p>
            {deliveryAddressLines.map((l, i) => <p key={i}>{l}</p>)}
          </div>
          <div>
            <p className="mb-1 font-bold">Terms &amp; Condition:</p>
            <p>Delivery : {po.delivery_terms}</p>
            <p>Payment : {po.payment_terms}</p>
            <p>Freight : {po.freight_terms}</p>
          </div>
        </div>

        {/* Signatures */}
        <DocumentSignatureBlock labels={["PREPARED BY", "VERIFIED BY", "APPROVED BY"]} signed={signingState.signed} requiredSlots={signingState.requiredSlots} />
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, canWriteMasters } from "@/lib/auth";
import { canDeletePurchaseOrders } from "@/lib/roles";
import { getVendors, getComponentsFull, getCustomers } from "@/lib/masters-data";
import { getSigningState } from "@/lib/signatures";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { DocumentSignButton } from "@/components/document-sign-button";
import { PoEditor } from "./po-editor";
import { DeletePoButton } from "./delete-po-button";
import { signPo, backfillPoSignature } from "../actions";
import { projectLabel, cn } from "@/lib/utils";

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const { data: po } = await supabase.from("purchase_orders").select("*").eq("id", id).single();
  if (!po) notFound();

  // Editable while draft (in place) or sent/partial/completed (line edits
  // fork a revision, gated by the same price-approval mechanism) — only
  // cancelled/superseded is permanently read-only.
  const canWrite = canWriteMasters(profile?.role) && ["draft", "sent", "partial", "completed"].includes(po.status);
  const canDelete = canDeletePurchaseOrders(profile?.role, po);

  let currentRevisionId: string | null = null;
  if (po.superseded_by) {
    const rootId = po.root_po_id ?? po.id;
    const { data: lineage } = await supabase
      .from("purchase_orders")
      .select("id, superseded_by")
      .or(`id.eq.${rootId},root_po_id.eq.${rootId}`);
    currentRevisionId = (lineage ?? []).find((r) => r.superseded_by === null)?.id ?? null;
  }

  const [{ data: lines }, components, vendorsAll, { data: projects }, { data: vcs }, customers, { data: lastRates }, { data: mySignatures }] =
    await Promise.all([
      supabase.from("po_lines").select("*").eq("po_id", id).order("created_at"),
      getComponentsFull(),
      getVendors(),
      supabase.from("projects").select("id, project_no, customer_id").order("project_no"),
      supabase.from("vendor_components").select("component_id, price, vendor_id"),
      getCustomers(),
      supabase.from("v_last_component_rate").select("component_id, rate"),
      profile ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", profile.id).order("is_default", { ascending: false }) : Promise.resolve({ data: [] }),
    ]);
  const signingState = await getSigningState("po", id, po.created_by, profile?.id ?? null);
  const inProgress = ["draft", "pending_signature"].includes(po.status);
  const isBackfill = !signingState.fullySigned && !inProgress;
  const vendors = vendorsAll.filter((v) => v.is_active);
  const lastRateByComponent: Record<string, number> = {};
  for (const r of lastRates ?? []) {
    if (r.component_id && r.rate != null) lastRateByComponent[r.component_id] = Number(r.rate);
  }

  const compLabel = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const vName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const custName = new Map((customers ?? []).map((c) => [c.id, c.name]));

  // vendor suggestions per component (who supplies it + price)
  const suggestions: Record<string, { vendor: string; price: number | null }[]> = {};
  for (const vc of vcs ?? []) {
    (suggestions[vc.component_id] ??= []).push({ vendor: vName.get(vc.vendor_id) ?? "—", price: vc.price });
  }

  // components tagged to this PO's vendor — narrows the "Add line" picker by default
  const vendorComponentIds = po.vendor_id
    ? [...new Set((vcs ?? []).filter((vc) => vc.vendor_id === po.vendor_id).map((vc) => vc.component_id))]
    : [];

  const lineRows = (lines ?? []).map((l) => ({
    id: l.id,
    component_id: l.component_id,
    component_label: l.component_id ? compLabel.get(l.component_id) ?? "—" : "—",
    project_id: l.project_id,
    qty_ordered: l.qty_ordered,
    qty_received: l.qty_received,
    rate: l.rate,
    amount: l.amount,
    expected_date: l.expected_date,
    line_status: l.line_status,
    approval_status: l.approval_status,
    rejection_reason: l.rejection_reason,
  }));

  const pricesApproved = lineRows.every((l) => l.approval_status === "approved");
  const pendingCount = lineRows.filter((l) => l.approval_status !== "approved").length;
  // The print page enforces BOTH gates server-side; mirror them here so the
  // button doesn't look ready while the destination is still blocked.
  const printable = pricesApproved && signingState.fullySigned;
  const missingSignatures = signingState.requiredSlots.length - signingState.signed.length;
  const printBlockReason = !pricesApproved
    ? `${pendingCount} line(s) awaiting price approval`
    : `${missingSignatures} signature(s) still needed`;

  return (
    <div>
      <Link href="/purchase-orders" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All purchase orders
      </Link>
      <PageHeader
        title={po.po_no}
        description={po.vendor_id ? vName.get(po.vendor_id) ?? undefined : "no vendor yet"}
        action={
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{po.status}</Badge>
            {printable ? (
              <Link href={`/purchase-orders/${id}/print`} className={buttonVariants({ variant: "outline" })}>
                <Printer className="size-4" /> Print PO
              </Link>
            ) : (
              <span
                className={cn(buttonVariants({ variant: "outline" }), "cursor-not-allowed opacity-50")}
                title={`Cannot print — ${printBlockReason}`}
              >
                <Printer className="size-4" /> Print PO
              </span>
            )}
            {signingState.canSignNow && isBackfill && (
              <DocumentSignButton
                documentId={id}
                signatures={mySignatures ?? []}
                signAction={backfillPoSignature}
                label="Sign (for the record)"
                description="This PO was already sent before digital signatures existed — add your signature for the record. It won't change its status."
              />
            )}
            {signingState.canSignNow && !isBackfill && (
              <DocumentSignButton
                documentId={id}
                signatures={mySignatures ?? []}
                signAction={signPo}
                label={signingState.nextSlot === 1 ? "Sign & Send" : "Sign"}
                description={
                  signingState.nextSlot === 1
                    ? "Signing as the creator sends this PO — unless further approvers are configured, in which case it waits for their signature too."
                    : "Your signature is required to send this PO."
                }
              />
            )}
            {canDelete && <DeletePoButton poId={id} poNo={po.po_no} isRevisioned={po.revision_no > 0 || po.superseded_by !== null} />}
          </div>
        }
      />

      {!signingState.fullySigned && !signingState.canSignNow && !isBackfill && (
        <p className="mb-4 text-sm text-muted-foreground">
          Awaiting signature from {signingState.nextSignerName ?? "the next signer"} before this PO can be sent.
        </p>
      )}

      {po.superseded_by && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This PO has been superseded by a newer revision.
          {currentRevisionId && (
            <>
              {" "}
              <Link href={`/purchase-orders/${currentRevisionId}`} className="font-medium underline">
                View current revision
              </Link>
            </>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <PoEditor
            poId={id}
            header={{
              po_no: po.po_no,
              vendor_id: po.vendor_id,
              po_date: po.po_date,
              status: po.status,
              delivery_terms: po.delivery_terms,
              payment_terms: po.payment_terms,
              freight_terms: po.freight_terms,
              gst_percent: Number(po.gst_percent ?? 18),
              delivery_address: po.delivery_address,
            }}
            lines={lineRows}
            components={components ?? []}
            vendors={vendors ?? []}
            projects={(projects ?? []).map((p) => ({ id: p.id, label: projectLabel({ project_no: p.project_no, customer_name: p.customer_id ? custName.get(p.customer_id) ?? null : null }) }))}
            suggestions={suggestions}
            lastRateByComponent={lastRateByComponent}
            vendorComponentIds={vendorComponentIds}
            vendorName={po.vendor_id ? vName.get(po.vendor_id) ?? null : null}
            canWrite={canWrite}
            canSeeFinancials={finance}
          />
        </CardContent>
      </Card>
    </div>
  );
}

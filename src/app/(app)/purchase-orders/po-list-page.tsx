import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, canWriteMasters, canDownloadReports } from "@/lib/auth";
import { getVendors, getComponentsFull } from "@/lib/masters-data";
import { canApprovePoLine } from "@/lib/roles";
import { PageHeader } from "@/components/page-header";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatDate, formatNumber, formatINR, cn } from "@/lib/utils";
import { computeSigningStates } from "@/lib/signatures";
import { NewPoButton } from "./new-po-button";
import { PoLineApprovalActions } from "./po-line-approval-actions";
import { AllPosTable } from "./all-pos-table";
import { DocumentSignButton } from "@/components/document-sign-button";
import { getPoRegisterRows } from "@/lib/po-register-data";
import { readAll } from "@/lib/server/read-all";
import { signPo, backfillPoSignature } from "./actions";

export type PoScope = "normal" | "consumables";

/**
 * The PO list, shared by Purchase Orders and Consumables. A PO is in
 * Consumables when v_po_kind says so (raised there, or a consumables vendor
 * with only consumable lines); everything else is a normal PO. Each module
 * lists, counts and signs only its own POs. The Consumables register holds
 * only consumables POs; the main register keeps everything.
 */
export async function PoListPage({ scope, tab }: { scope: PoScope; tab: string }) {
  const consumables = scope === "consumables";
  const basePath = consumables ? "/consumables" : "/purchase-orders";
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const canWrite = canWriteMasters(profile?.role); // admin / team_lead
  const supabase = await createClient();

  // `livePos`, `poRights` and `poSigs` power the "Needs my signature" tab. They
  // sit in this same wave because none of them depends on another, so the tab
  // and its count cost no extra round trip — the arithmetic happens in memory
  // via computeSigningStates.
  const [vendorsAll, { data: nextPoNo }, pendingApprovalLines, pendingSignaturePos, { data: poApproverRight }, { data: mySignatures }, livePos, { data: poRights }, poSigs, consumablesPoIds] = await Promise.all([
    getVendors(),
    supabase.rpc("peek_next_po_no"),
    readAll((f, t) => supabase.from("po_lines")
      .select("po_id, purchase_orders!inner(status)")
      .eq("approval_status", "pending_approval")
      .neq("purchase_orders.status", "superseded")
      .order("id").range(f, t)),
    readAll((f, t) => supabase.from("purchase_orders").select("id").eq("status", "pending_signature").order("id").range(f, t)),
    supabase.from("approval_rights").select("user_id").eq("document_type", "po").eq("approver_order", 2).maybeSingle(),
    profile ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", profile.id).order("is_default", { ascending: false }) : Promise.resolve({ data: [] }),
    readAll((f, t) => supabase.from("purchase_orders").select("id, po_no, vendor_id, status, created_by, created_at").is("superseded_by", null).order("id").range(f, t)),
    supabase.from("approval_rights").select("approver_order, user_id").eq("document_type", "po"),
    // Over 1,000 PO signatures exist; a single read silently dropped the rest.
    readAll((f, t) => supabase.from("document_signatures").select("document_id, slot").eq("document_type", "po").order("document_id").order("slot").range(f, t)),
    consumablesPoIdSet(supabase),
  ]);
  const inScope = (poId: string) => consumablesPoIds.has(poId) === consumables;
  // New POs here go to consumables vendors only; the normal page keeps every vendor.
  const vendors = vendorsAll.filter((v) => v.is_active && (!consumables || v.is_consumables_vendor));
  const pendingApprovalCount = pendingApprovalLines.filter((l) => inScope(l.po_id)).length;
  const pendingSignatureCount = pendingSignaturePos.filter((p) => inScope(p.id)).length;
  const canApprove = canApprovePoLine(profile?.role, profile?.id, poApproverRight?.user_id ?? null);
  const approvalsCount = canApprove ? (pendingApprovalCount ?? 0) + (pendingSignatureCount ?? 0) : 0;

  // Every PO whose next unsigned slot belongs to this user — theirs alone, and
  // only once the slot before it has been signed. Superseded revisions are
  // excluded: they are dead history and can never be printed anyway.
  const scopedLivePos = (livePos ?? []).filter((p) => inScope(p.id));
  const signingStates = computeSigningStates(
    scopedLivePos.map((p) => ({ id: p.id, created_by: p.created_by })),
    poRights ?? [],
    poSigs ?? [],
    profile?.id ?? null,
  );
  const needsMySignature = scopedLivePos
    .filter((p) => signingStates.get(p.id)?.canSignNow)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  const TABS = [
    { key: "all", label: "All POs" },
    { key: "signatures", label: `Needs my signature${needsMySignature.length ? ` (${needsMySignature.length})` : ""}` },
    { key: "approvals", label: `Approvals${approvalsCount ? ` (${approvalsCount})` : ""}` },
  ] as const;

  return (
    <div>
      <PageHeader
        title={consumables ? "Consumables" : "Purchase Orders"}
        description={
          consumables
            ? "Consumables bought for stock from consumables vendors. Projects consume them straight from stock through requisitions — they are never blocked for a project."
            : "Orders to vendors. Batched across projects; project tags are back-fillable."
        }
        action={canWrite && tab === "all" ? <NewPoButton vendors={vendors ?? []} defaultPoNo={nextPoNo ?? ""} consumables={consumables} /> : undefined}
      />

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}${t.key === "all" ? "" : `?tab=${t.key}`}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "signatures" ? (
        <NeedsMySignatureTab rows={needsMySignature} vendors={vendorsAll} mySignatures={mySignatures ?? []} basePath={basePath} />
      ) : tab === "approvals" ? (
        <ApprovalsTab canApprove={canApprove} mySignatures={mySignatures ?? []} inScope={inScope} basePath={basePath} />
      ) : (
        <AllPosTab finance={finance} canDownload={canDownloadReports(profile?.role)} vendors={vendorsAll} inScope={inScope} consumables={consumables} basePath={basePath} />
      )}
    </div>
  );
}

async function AllPosTab({
  finance, canDownload, vendors, inScope, consumables, basePath,
}: {
  finance: boolean; canDownload: boolean; vendors: { id: string; name: string }[];
  inScope: (poId: string) => boolean; consumables: boolean; basePath: string;
}) {
  const supabase = await createClient();
  const [allPos, allRegisterRows] = await Promise.all([
    readAll((f, t) => supabase.from("purchase_orders").select("*").neq("status", "superseded").order("created_at", { ascending: false }).order("id").range(f, t)),
    canDownload ? getPoRegisterRows(supabase, finance) : Promise.resolve([]),
  ]);
  const pos = allPos.filter((po) => inScope(po.id));
  // Consumables' register holds only its own POs; the main register keeps everything.
  const scopedPoNos = new Set(pos.map((po) => po.po_no));
  const poRegisterRows = consumables
    ? allRegisterRows
        .map((r) => ({ ...r, lines: r.lines.filter((l) => scopedPoNos.has(l.poNo)) }))
        .filter((r) => r.lines.length > 0)
    : allRegisterRows;
  const vName = new Map(vendors.map((v) => [v.id, v.name]));

  // Who's a stuck PO waiting on? Computed in bulk (not per-row) so admins/
  // creators can see this straight from the list without opening each PO.
  const pendingIds = (pos ?? []).filter((po) => po.status === "pending_signature").map((po) => po.id);
  const [{ data: rights }, { data: sigs }] = await Promise.all([
    supabase.from("approval_rights").select("approver_order, user_id").eq("document_type", "po"),
    pendingIds.length
      ? supabase.from("document_signatures").select("document_id, slot").eq("document_type", "po").in("document_id", pendingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const rightsByOrder = new Map((rights ?? []).map((r) => [r.approver_order, r.user_id]));
  const requiredSlots = [...new Set([1, ...(rights ?? []).map((r) => r.approver_order)])].sort((a, b) => a - b);
  const signedSlotsByPo = new Map<string, Set<number>>();
  for (const s of sigs ?? []) {
    if (!signedSlotsByPo.has(s.document_id)) signedSlotsByPo.set(s.document_id, new Set());
    signedSlotsByPo.get(s.document_id)!.add(s.slot);
  }
  const nextSignerIdByPo = new Map<string, string | null>();
  for (const po of pos ?? []) {
    if (po.status !== "pending_signature") continue;
    const signedSlots = signedSlotsByPo.get(po.id) ?? new Set();
    const nextSlot = requiredSlots.find((s) => !signedSlots.has(s)) ?? null;
    nextSignerIdByPo.set(po.id, nextSlot === null ? null : nextSlot === 1 ? po.created_by : rightsByOrder.get(nextSlot) ?? null);
  }
  const signerIds = [...new Set([...nextSignerIdByPo.values()].filter((v): v is string => !!v))];
  const { data: signerProfiles } = signerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", signerIds)
    : { data: [] };
  const signerName = new Map((signerProfiles ?? []).map((p) => [p.id, p.full_name]));

  // PO lines that took in more than was ordered. The line-level badge for this
  // already exists on the PO itself, but it was only reachable by opening each
  // PO in turn, so a mis-keyed receipt could sit unnoticed. Counting it here
  // surfaces it on the list. Derived from the register rows already loaded
  // above — same scope (no drafts, no superseded, no cancelled lines) and no
  // extra query. The tolerance matches the PO editor's, so a float artefact
  // like 73.19999999999999 vs 73.2 isn't reported as an over-receipt.
  const overReceivedByPoNo = new Map<string, number>();
  for (const r of poRegisterRows) {
    for (const l of r.lines) {
      if (l.receivedQty > l.orderedQty + 1e-6) {
        overReceivedByPoNo.set(l.poNo, (overReceivedByPoNo.get(l.poNo) ?? 0) + 1);
      }
    }
  }

  const rows = (pos ?? []).map((po) => ({
    id: po.id,
    po_no: po.po_no,
    vendor_name: po.vendor_id ? vName.get(po.vendor_id) ?? null : null,
    po_date: po.po_date,
    status: po.status,
    total_amount: finance ? po.total_amount : null,
    waiting_on: po.status === "pending_signature" ? signerName.get(nextSignerIdByPo.get(po.id) ?? "") ?? null : null,
    over_received_lines: overReceivedByPoNo.get(po.po_no) ?? 0,
  }));

  return <AllPosTable pos={rows} finance={finance} canDownload={canDownload} poRegisterRows={poRegisterRows} basePath={basePath} />;
}

type SignRow = {
  id: string; po_no: string; vendor_id: string | null;
  status: string; created_at: string | null;
};

/**
 * Every PO waiting on *this* user's signature — nobody else's. The rows are
 * already computed on the page (one wave, no extra query), so this only has to
 * render them.
 *
 * Which button appears matters. A PO still in draft/pending_signature is mid
 * flow, so signing drives it forward via signPo. One already sent, received or
 * completed has moved on without a signature — every PO raised before digital
 * signatures existed is in that state — so it takes backfillPoSignature, which
 * records the signature for the audit trail without touching the PO's status.
 * This mirrors the same decision on the PO detail page.
 */
function NeedsMySignatureTab({
  rows, vendors, mySignatures, basePath,
}: {
  rows: SignRow[];
  vendors: { id: string; name: string }[];
  mySignatures: MySig[];
  basePath: string;
}) {
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">Nothing is waiting on your signature.</p>;
  }

  return (
    <>
      <p className="mb-3 text-xs text-muted-foreground">
        Waiting on you, oldest first. A PO only appears here once the signature before yours is in.
      </p>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead className="w-48 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((po) => {
              const isBackfill = !["draft", "pending_signature"].includes(po.status);
              return (
                <TableRow key={po.id}>
                  <TableCell>
                    <Link href={`${basePath}/${po.id}`} className="text-primary hover:underline">{po.po_no}</Link>
                  </TableCell>
                  <TableCell>{po.vendor_id ? vendorName.get(po.vendor_id) ?? "—" : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={isBackfill ? "outline" : "secondary"}>{po.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(po.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <DocumentSignButton
                      documentId={po.id}
                      signatures={mySignatures}
                      signAction={isBackfill ? backfillPoSignature : signPo}
                      label={isBackfill ? "Sign (for the record)" : "Sign"}
                      description={
                        isBackfill
                          ? "This PO already moved on before digital signatures existed — add yours for the record. It won't change its status."
                          : "Your signature moves this PO forward."
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-3 sm:hidden">
        {rows.map((po) => {
          const isBackfill = !["draft", "pending_signature"].includes(po.status);
          return (
            <MobileRowCard
              key={po.id}
              title={<Link href={`${basePath}/${po.id}`} className="text-primary hover:underline">{po.po_no}</Link>}
              subtitle={formatDate(po.created_at)}
              badge={<Badge variant={isBackfill ? "outline" : "secondary"}>{po.status}</Badge>}
              fields={[{ label: "Vendor", value: po.vendor_id ? vendorName.get(po.vendor_id) ?? "—" : "—" }]}
              actions={
                <DocumentSignButton
                  documentId={po.id}
                  signatures={mySignatures}
                  signAction={isBackfill ? backfillPoSignature : signPo}
                  label={isBackfill ? "Sign (for the record)" : "Sign"}
                  description={
                    isBackfill
                      ? "This PO already moved on before digital signatures existed — add yours for the record. It won't change its status."
                      : "Your signature moves this PO forward."
                  }
                />
              }
            />
          );
        })}
      </div>
    </>
  );
}

type MySig = { id: string; label: string | null; method: string; image_data_url: string; is_default: boolean };

async function ApprovalsTab({
  canApprove, mySignatures, inScope, basePath,
}: { canApprove: boolean; mySignatures: MySig[]; inScope: (poId: string) => boolean; basePath: string }) {
  const supabase = await createClient();

  const { data: awaitingSignatureAll } = canApprove
    ? await supabase.from("purchase_orders").select("id, po_no, vendor_id, created_at").eq("status", "pending_signature").order("created_at", { ascending: true })
    : { data: [] };
  const awaitingSignature = (awaitingSignatureAll ?? []).filter((po) => inScope(po.id));
  const sigVendorIds = [...new Set((awaitingSignature ?? []).map((po) => po.vendor_id).filter((v): v is string => !!v))];
  const { data: sigVendors } = sigVendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", sigVendorIds)
    : { data: [] };
  const sigVendorName = new Map((sigVendors ?? []).map((v) => [v.id, v.name]));

  const { data: allPending } = await supabase
    .from("po_lines")
    .select("id, po_id, component_id, rate, qty_ordered, created_by, created_at")
    .eq("approval_status", "pending_approval")
    .order("created_at", { ascending: true });

  const poIds = [...new Set((allPending ?? []).map((l) => l.po_id))];
  const { data: pos } = poIds.length
    ? await supabase.from("purchase_orders").select("id, po_no, status").in("id", poIds)
    : { data: [] };
  const poNo = new Map((pos ?? []).map((p) => [p.id, p.po_no]));
  const poStatus = new Map((pos ?? []).map((p) => [p.id, p.status]));

  // A pending line whose PO was superseded belongs to dead history now —
  // it stays pending_approval forever (correctly, for print/audit fidelity)
  // but shouldn't clutter the live worklist.
  const pending = (allPending ?? []).filter((l) => poStatus.get(l.po_id) !== "superseded" && inScope(l.po_id));

  const raiserIds = [...new Set(pending.map((l) => l.created_by).filter((v): v is string => !!v))];
  // Components come from the shared cached loader rather than an `.in("id", …)` over
  // every pending line's component: that array reached 380 ids here, and PostgREST
  // rejects the request once the ids push the URL past the ~16 KB header limit — the
  // same failure that was silently blanking the inventory export. The loader is already
  // resolved for this render, so this also drops a round trip.
  const [components, { data: raisers }] = await Promise.all([
    getComponentsFull(),
    raiserIds.length ? supabase.from("profiles").select("id, full_name").in("id", raiserIds) : Promise.resolve({ data: [] }),
  ]);
  const compLabel = new Map(components.map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const raiserName = new Map((raisers ?? []).map((p) => [p.id, p.full_name]));

  if (!canApprove) {
    return <p className="py-8 text-center text-muted-foreground">Only the configured PO approver (or Admin, if none is configured) can review this.</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Awaiting your signature</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Sent to you</TableHead>
              <TableHead className="w-40 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(awaitingSignature ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nothing awaiting your signature.</TableCell></TableRow>
            ) : (
              (awaitingSignature ?? []).map((po) => (
                <TableRow key={po.id}>
                  <TableCell>
                    <Link href={`${basePath}/${po.id}`} className="text-primary hover:underline">{po.po_no}</Link>
                  </TableCell>
                  <TableCell>{po.vendor_id ? sigVendorName.get(po.vendor_id) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(po.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <DocumentSignButton documentId={po.id} signatures={mySignatures} signAction={signPo} label="Sign" description="Your signature is required to send this PO." />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pending price approval</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Raised by</TableHead>
              <TableHead>Raised</TableHead>
              <TableHead className="w-40 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nothing pending approval.</TableCell></TableRow>
            ) : (
              pending.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <Link href={`${basePath}/${l.po_id}`} className="text-primary hover:underline">{poNo.get(l.po_id) ?? "—"}</Link>
                  </TableCell>
                  <TableCell>{l.component_id ? compLabel.get(l.component_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{formatNumber(l.qty_ordered)}</TableCell>
                  <TableCell>{formatINR(l.rate)}</TableCell>
                  <TableCell>{l.created_by ? raiserName.get(l.created_by) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(l.created_at)}</TableCell>
                  <TableCell className="text-right"><PoLineApprovalActions lineId={l.id} signatures={mySignatures} /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Ids of every PO that belongs in Consumables (see v_po_kind). */
async function consumablesPoIdSet(supabase: Awaited<ReturnType<typeof createClient>>) {
  const rows = await readAll((f, t) =>
    supabase.from("v_po_kind").select("po_id").eq("is_consumables", true).order("po_id").range(f, t));
  return new Set(rows.map((r) => r.po_id).filter((v): v is string => !!v));
}

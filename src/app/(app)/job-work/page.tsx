import Link from "next/link";
import { Hammer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { getVendors, getComponentsFull, getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { DocumentSignButton } from "@/components/document-sign-button";
import { formatNumber, formatDate, projectLabel, cn } from "@/lib/utils";
import { NewJwButton } from "./new-jw-button";
import { JwOrdersTable } from "./jw-orders-table";
import { signJobWork } from "./actions";

export default async function JobWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePathAccess("/job-work");
  const { tab = "all" } = await searchParams;
  const profile = await getProfile();
  const canWrite = canWriteMasters(profile?.role); // admin / team_lead
  const supabase = await createClient();

  const [{ data: orders }, vendorsAll, { data: projects }, { data: rawLots }, comps, customers, { count: pendingSignatureCount }, { data: jwApproverRight }] =
    await Promise.all([
      supabase.from("job_work_orders").select("*").neq("status", "superseded").order("created_at", { ascending: false }),
      getVendors(),
      supabase.from("projects").select("id, project_no, customer_id").order("project_no"),
      // "issued" (project-reserved) raw lots can still be sent for job work under
      // an order for that project, so count them here alongside free "open" stock.
      supabase.from("inventory_lots").select("component_id, qty_on_hand").eq("jw_stage", "raw").in("status", ["open", "issued"]).gt("qty_on_hand", 0),
      getComponentsFull(),
      getCustomers(),
      supabase.from("job_work_orders").select("id", { count: "exact", head: true }).eq("status", "pending_signature"),
      supabase.from("approval_rights").select("user_id").eq("document_type", "job_work").eq("approver_order", 2).maybeSingle(),
    ]);
  const vendors = vendorsAll.filter((v) => v.is_active);

  const jwApproverId = jwApproverRight?.user_id ?? null;
  const canApprove = !!profile?.id && (jwApproverId ? profile.id === jwApproverId : profile.role === "admin");
  const approvalsCount = canApprove ? (pendingSignatureCount ?? 0) : 0;

  const vName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const compById = new Map((comps ?? []).map((c) => [c.id, c]));
  const custName = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const projectsWithCustomer = (projects ?? []).map((p) => ({ ...p, customer_name: p.customer_id ? custName.get(p.customer_id) ?? null : null }));
  const projLabel = new Map(projectsWithCustomer.map((p) => [p.id, projectLabel(p)]));

  // raw stock awaiting job work, grouped by component
  const awaiting = new Map<string, number>();
  for (const l of rawLots ?? []) awaiting.set(l.component_id, (awaiting.get(l.component_id) ?? 0) + Number(l.qty_on_hand ?? 0));

  // Who's a stuck order waiting on? Computed in bulk so admins/creators can
  // see this straight from the list without opening each order.
  const pendingIds = (orders ?? []).filter((o) => o.status === "pending_signature").map((o) => o.id);
  const [{ data: rights }, { data: sigs }] = await Promise.all([
    supabase.from("approval_rights").select("approver_order, user_id").eq("document_type", "job_work"),
    pendingIds.length
      ? supabase.from("document_signatures").select("document_id, slot").eq("document_type", "job_work").in("document_id", pendingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const rightsByOrder = new Map((rights ?? []).map((r) => [r.approver_order, r.user_id]));
  const requiredSlots = [...new Set([1, ...(rights ?? []).map((r) => r.approver_order)])].sort((a, b) => a - b);
  const signedSlotsByOrder = new Map<string, Set<number>>();
  for (const s of sigs ?? []) {
    if (!signedSlotsByOrder.has(s.document_id)) signedSlotsByOrder.set(s.document_id, new Set());
    signedSlotsByOrder.get(s.document_id)!.add(s.slot);
  }
  const nextSignerIdByOrder = new Map<string, string | null>();
  for (const o of orders ?? []) {
    if (o.status !== "pending_signature") continue;
    const signedSlots = signedSlotsByOrder.get(o.id) ?? new Set();
    const nextSlot = requiredSlots.find((s) => !signedSlots.has(s)) ?? null;
    nextSignerIdByOrder.set(o.id, nextSlot === null ? null : nextSlot === 1 ? o.created_by : rightsByOrder.get(nextSlot) ?? null);
  }
  const signerIds = [...new Set([...nextSignerIdByOrder.values()].filter((v): v is string => !!v))];
  const { data: signerProfiles } = signerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", signerIds)
    : { data: [] };
  const signerName = new Map((signerProfiles ?? []).map((p) => [p.id, p.full_name]));

  const TABS = [
    { key: "all", label: "All Job Work" },
    { key: "signatures", label: `Pending Signature${approvalsCount ? ` (${approvalsCount})` : ""}` },
  ] as const;

  return (
    <div>
      <PageHeader
        title="Job Work"
        description="Send raw components to a job-work vendor and receive the finished part back. The completed lot's cost = raw + job-work rate."
        action={canWrite && tab === "all" ? <NewJwButton vendors={vendors ?? []} projects={projectsWithCustomer} /> : undefined}
      />

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/job-work${t.key === "all" ? "" : `?tab=${t.key}`}`}
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
        <SignaturesTab canApprove={canApprove} profileId={profile?.id ?? null} />
      ) : (
        <>
          {awaiting.size > 0 && (
            <Card className="mb-6 border-amber-200 bg-amber-50/50">
              <CardContent className="p-5">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <Hammer className="size-4" /> Raw stock awaiting job work
                </p>
                <div className="flex flex-wrap gap-2">
                  {[...awaiting].map(([cid, qty]) => {
                    const c = compById.get(cid);
                    return (
                      <span key={cid} className="rounded-md border border-amber-200 bg-white px-2.5 py-1 text-xs">
                        <span className="font-medium">{c ? `${c.component_no} — ${c.name}` : cid}</span>
                        <span className="text-muted-foreground"> · {formatNumber(qty)} raw</span>
                        {c?.jw_vendor_id && <span className="text-muted-foreground"> → {vName.get(c.jw_vendor_id) ?? "—"}</span>}
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <JwOrdersTable
            orders={(orders ?? []).map((o) => ({
              id: o.id,
              jw_no: o.jw_no,
              project_id: o.project_id,
              project_label: o.project_id ? projLabel.get(o.project_id) ?? null : null,
              vendor_name: o.vendor_id ? vName.get(o.vendor_id) ?? null : null,
              sent_date: o.sent_date,
              expected_date: o.expected_date,
              status: o.status,
              waiting_on: o.status === "pending_signature" ? signerName.get(nextSignerIdByOrder.get(o.id) ?? "") ?? null : null,
            }))}
          />
        </>
      )}
    </div>
  );
}

async function SignaturesTab({ canApprove, profileId }: { canApprove: boolean; profileId: string | null }) {
  const supabase = await createClient();

  if (!canApprove) {
    return <p className="py-8 text-center text-muted-foreground">Only the configured Job-Work approver (or Admin, if none is configured) can review this.</p>;
  }

  const [{ data: awaitingSignature }, { data: mySignatures }] = await Promise.all([
    supabase.from("job_work_orders").select("id, jw_no, vendor_id, created_at").eq("status", "pending_signature").order("created_at", { ascending: true }),
    profileId
      ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", profileId).order("is_default", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const vendorIds = [...new Set((awaitingSignature ?? []).map((o) => o.vendor_id).filter((v): v is string => !!v))];
  const { data: vendors } = vendorIds.length
    ? await supabase.from("vendors").select("id, name").in("id", vendorIds)
    : { data: [] };
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>JW No.</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="w-40 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {(awaitingSignature ?? []).length === 0 ? (
          <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Nothing awaiting your signature.</TableCell></TableRow>
        ) : (
          (awaitingSignature ?? []).map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <Link href={`/job-work/${o.id}`} className="text-primary hover:underline">{o.jw_no}</Link>
              </TableCell>
              <TableCell>{o.vendor_id ? vendorName.get(o.vendor_id) ?? "—" : "—"}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(o.created_at)}</TableCell>
              <TableCell className="text-right">
                <DocumentSignButton documentId={o.id} signatures={mySignatures ?? []} signAction={signJobWork} label="Sign" description="Signing sends this material to the vendor." />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

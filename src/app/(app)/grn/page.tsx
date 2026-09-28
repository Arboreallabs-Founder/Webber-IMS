import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getVendors, getComponentsSafe } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatDate, formatNumber, cn } from "@/lib/utils";
import { getSigningStatesBatch } from "@/lib/signatures";
import { DocumentSignButton } from "@/components/document-sign-button";
import { NewGrnButton } from "./new-grn-button";
import { IrnApprovalActions } from "./irn-approval-actions";
import { AllGrnsTable, type GrnRow } from "./all-grns-table";
import { getPoRegisterRows } from "@/lib/po-register-data";
import { signGrn } from "./actions";

const TABS = [
  { key: "all", label: "All GRNs" },
  { key: "approval", label: "Pending Approval" },
  { key: "register", label: "IRN Register" },
];

export default async function GrnPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; q?: string }>;
}) {
  const { tab = "all", from = "", to = "", q = "" } = await searchParams;
  const profile = await getProfile();
  const canApprove = profile?.role === "admin" || profile?.role === "team_lead" || profile?.role === "inventory_admin";

  return (
    <div>
      <PageHeader
        title="Goods Receipt"
        description="Receive material at the gate — attach to a project or open PO per line as you go."
        action={tab === "all" ? <NewGrnButton vendors={await activeVendors()} /> : undefined}
      />

      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/grn${t.key === "all" ? "" : `?tab=${t.key}`}`}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "approval" && <ApprovalTab canApprove={canApprove} userId={profile?.id ?? null} />}
      {tab === "register" && <RegisterTab from={from} to={to} q={q} />}
      {tab === "all" && <AllGrnsTab />}
    </div>
  );
}

async function activeVendors() {
  const vendors = await getVendors();
  return vendors.filter((v) => v.is_active).map((v) => ({ id: v.id, name: v.name }));
}

async function AllGrnsTab() {
  const supabase = await createClient();
  const finance = canSeeFinancials((await getProfile())?.role);
  const [{ data: grns }, vendors, { data: lines }, poRegisterRows] = await Promise.all([
    supabase.from("grns").select("*").order("received_at", { ascending: false }),
    activeVendors(),
    supabase.from("grn_lines").select("grn_id"),
    getPoRegisterRows(supabase),
  ]);

  const vName = new Map((vendors ?? []).map((v) => [v.id, v.name]));
  const lineCount = new Map<string, number>();
  for (const l of lines ?? []) lineCount.set(l.grn_id, (lineCount.get(l.grn_id) ?? 0) + 1);

  const rows: GrnRow[] = (grns ?? []).map((g) => ({
    id: g.id,
    grn_no: g.grn_no,
    vendor_name: g.vendor_id ? vName.get(g.vendor_id) ?? null : null,
    challan_no: g.challan_no,
    invoice_no: g.invoice_no,
    line_count: lineCount.get(g.id) ?? 0,
    received_at: g.received_at,
  }));

  return <AllGrnsTable rows={rows} poRegisterRows={poRegisterRows} finance={finance} />;
}

async function ApprovalTab({ canApprove, userId }: { canApprove: boolean; userId: string | null }) {
  const supabase = await createClient();
  const [{ data: irns }, { data: mySignatures }, { data: allGrns }] = await Promise.all([
    supabase
      .from("irns")
      .select("id, irn_no, component_id, qty, generated_by, generated_at, grn_id")
      .eq("status", "pending_approval")
      .order("generated_at", { ascending: true }),
    userId
      ? supabase.from("signatures").select("id, label, method, image_data_url, is_default").eq("user_id", userId).order("is_default", { ascending: false })
      : Promise.resolve({ data: [] }),
    userId
      ? supabase.from("grns").select("id, grn_no, created_by, created_at, vendor_id").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const generatorIds = [...new Set((irns ?? []).map((i) => i.generated_by))];
  const irnGrnIds = [...new Set((irns ?? []).map((i) => i.grn_id))];

  const signingStates = await getSigningStatesBatch(
    "grn",
    (allGrns ?? []).map((g) => ({ id: g.id, created_by: g.created_by })),
    userId,
  );
  const signaturePendingGrns = (allGrns ?? []).filter((g) => {
    const s = signingStates.get(g.id);
    return s?.canSignNow && !s.fullySigned;
  });
  const creatorIds = [...new Set(signaturePendingGrns.map((g) => g.created_by).filter(Boolean))] as string[];

  // Components and vendors come from the shared cached loaders instead of `.in("id", …)`
  // over every referenced id — those arrays grow with the data and eventually push the
  // request URL past PostgREST's ~16 KB header limit, which fails silently.
  const [components, { data: generators }, { data: irnGrns }, { data: creators }, vendors] = await Promise.all([
    getComponentsSafe(),
    generatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", generatorIds) : Promise.resolve({ data: [] }),
    irnGrnIds.length ? supabase.from("grns").select("id, grn_no").in("id", irnGrnIds) : Promise.resolve({ data: [] }),
    creatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", creatorIds) : Promise.resolve({ data: [] }),
    getVendors(),
  ]);
  const compLabel = new Map(components.map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const genName = new Map((generators ?? []).map((p) => [p.id, p.full_name]));
  const grnNo = new Map((irnGrns ?? []).map((g) => [g.id, g.grn_no]));
  const creatorName = new Map((creators ?? []).map((p) => [p.id, p.full_name]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id, v.name]));

  const hasSignatureRows = signaturePendingGrns.length > 0;

  if (!canApprove && !hasSignatureRows) {
    return <p className="py-8 text-center text-muted-foreground">Only Admin / Team Lead can review pending inspections.</p>;
  }

  return (
    <div className="space-y-8">
      {hasSignatureRows && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Awaiting your signature
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>GRN No.</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {signaturePendingGrns.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link href={`/grn/${g.id}`} className="font-medium text-primary hover:underline">{g.grn_no}</Link>
                  </TableCell>
                  <TableCell>{g.vendor_id ? vendorName.get(g.vendor_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{g.created_by ? creatorName.get(g.created_by) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(g.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <DocumentSignButton
                      documentId={g.id}
                      signatures={mySignatures ?? []}
                      signAction={signGrn}
                      label="Sign GRN"
                      description={`Sign ${g.grn_no} as received/approved.`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canApprove && (
        <div>
          {hasSignatureRows && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Pending inspection approval
            </h2>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IRN No.</TableHead>
                <TableHead>GRN</TableHead>
                <TableHead>Component</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Generated by</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(irns ?? []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nothing pending approval.</TableCell></TableRow>
              ) : (
                (irns ?? []).map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.irn_no}</TableCell>
                    <TableCell>
                      <Link href={`/grn/${i.grn_id}`} className="text-primary hover:underline">{grnNo.get(i.grn_id) ?? "—"}</Link>
                    </TableCell>
                    <TableCell>{i.component_id ? compLabel.get(i.component_id) ?? "—" : "—"}</TableCell>
                    <TableCell>{formatNumber(i.qty)}</TableCell>
                    <TableCell>{i.generated_by ? genName.get(i.generated_by) ?? "—" : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(i.generated_at)}</TableCell>
                    <TableCell className="text-right"><IrnApprovalActions irnId={i.id} signatures={mySignatures ?? []} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

async function RegisterTab({ from, to, q }: { from: string; to: string; q: string }) {
  const supabase = await createClient();
  let query = supabase
    .from("irns")
    .select("id, irn_no, component_id, qty, status, generated_by, generated_at, approved_by, approved_at, rejection_reason, grn_id")
    .order("generated_at", { ascending: false });
  if (from) query = query.gte("generated_at", from);
  if (to) query = query.lte("generated_at", `${to}T23:59:59`);
  const { data: irns } = await query;

  const peopleIds = [...new Set([...(irns ?? []).map((i) => i.generated_by), ...(irns ?? []).map((i) => i.approved_by)].filter(Boolean))] as string[];
  const grnIds = [...new Set((irns ?? []).map((i) => i.grn_id))];
  const [components, { data: people }, { data: grns }] = await Promise.all([
    getComponentsSafe(),
    peopleIds.length ? supabase.from("profiles").select("id, full_name").in("id", peopleIds) : Promise.resolve({ data: [] }),
    grnIds.length ? supabase.from("grns").select("id, grn_no").in("id", grnIds) : Promise.resolve({ data: [] }),
  ]);
  const compLabel = new Map(components.map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const personName = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const grnNo = new Map((grns ?? []).map((g) => [g.id, g.grn_no]));

  const qLower = q.trim().toLowerCase();
  const rows = (irns ?? []).filter((i) => {
    if (!qLower) return true;
    const label = i.component_id ? compLabel.get(i.component_id) ?? "" : "";
    return i.irn_no.toLowerCase().includes(qLower) || label.toLowerCase().includes(qLower);
  });

  const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
    approved: "success", pending_approval: "warning", rejected: "destructive",
  };

  return (
    <div>
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <input type="hidden" name="tab" value="register" />
        <div className="space-y-1.5">
          <Label>From</Label>
          <Input type="date" name="from" defaultValue={from} />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input type="date" name="to" defaultValue={to} />
        </div>
        <div className="min-w-[200px] flex-1 space-y-1.5">
          <Label>Search (IRN no. / component)</Label>
          <Input name="q" defaultValue={q} placeholder="IRN/26-27/0001 or component name" />
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>IRN No.</TableHead>
            <TableHead>GRN</TableHead>
            <TableHead>Component</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Generated by</TableHead>
            <TableHead>Approved/Rejected by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No IRNs match this filter.</TableCell></TableRow>
          ) : (
            rows.map((i) => {
              const isSelfApproved = i.generated_by && i.approved_by && i.generated_by === i.approved_by;
              return (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.irn_no}</TableCell>
                  <TableCell>
                    <Link href={`/grn/${i.grn_id}`} className="text-primary hover:underline">{grnNo.get(i.grn_id) ?? "—"}</Link>
                  </TableCell>
                  <TableCell>{i.component_id ? compLabel.get(i.component_id) ?? "—" : "—"}</TableCell>
                  <TableCell>{formatNumber(i.qty)}</TableCell>
                  <TableCell><Badge variant={STATUS_VARIANT[i.status] ?? "secondary"}>{i.status.replace("_", " ")}</Badge></TableCell>
                  <TableCell>{i.generated_by ? personName.get(i.generated_by) ?? "—" : "—"}</TableCell>
                  <TableCell>
                    {i.approved_by
                      ? `${personName.get(i.approved_by) ?? "—"}${isSelfApproved ? " (auto-approved, self)" : ""}`
                      : "—"}
                    {i.status === "rejected" && i.rejection_reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{i.rejection_reason}</p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

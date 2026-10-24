import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials, requirePathAccess } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatINR, formatNumber, projectLabel } from "@/lib/utils";
import { InventorySplitCards, type ProjectValue } from "./inventory-split-cards";
import { readAll } from "@/lib/server/read-all";

export default async function DashboardPage() {
  await requirePathAccess("/");
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const [activeP, overdue, untagged, missingPo, stale, variance, costingRes, onhandRes, projectsRes, customersRes] =
    await Promise.all([
      supabase.from("projects").select("*", { count: "exact", head: true }).neq("status", "closed"),
      supabase.from("v_po_overdue").select("po_id"),
      supabase.from("v_untagged_receipts").select("*", { count: "exact", head: true }),
      supabase.from("v_missing_po").select("*", { count: "exact", head: true }),
      supabase.from("v_stale_stock").select("*", { count: "exact", head: true }),
      supabase.from("v_bom_variance").select("*", { count: "exact", head: true }).or("uncovered_qty.gt.0,receive_gap.gt.0"),
      supabase.from("v_project_costing").select("*"),
      finance ? shelfStockByStatus(supabase) : Promise.resolve(null),
      supabase.from("projects").select("id, project_no, customer_id"),
      getCustomers(),
    ]);

  const custName = new Map(customersRes.map((c) => [c.id, c.name]));
  const custIdByProject = new Map((projectsRes.data ?? []).map((p) => [p.id, p.customer_id]));

  const c = (r: { count: number | null }) => r.count ?? 0;
  const overdueLines = overdue.data ?? [];
  const overduePoCount = new Set(overdueLines.map((r) => r.po_id)).size;
  // WIP = everything consumed into projects; same figure as the costing view's consumed_value.
  const wipValue = finance ? (costingRes.data ?? []).reduce((s, r) => s + Number(r.consumed_value ?? 0), 0) : null;

  const labelFor = (projectId: string, projectNo?: string | null) => {
    const no = projectNo ?? projectNoById.get(projectId) ?? "—";
    return projectLabel({ project_no: no, customer_name: custName.get(custIdByProject.get(projectId) ?? "") ?? null });
  };
  const projectNoById = new Map((projectsRes.data ?? []).map((p) => [p.id, p.project_no]));
  const byValueDesc = (a: ProjectValue, b: ProjectValue) => b.value - a.value;
  const wipByProject: ProjectValue[] = (costingRes.data ?? [])
    .filter((r) => r.project_id && Number(r.consumed_value ?? 0) > 0.5)
    .map((r) => ({ projectId: r.project_id!, label: labelFor(r.project_id!, r.project_no), value: Number(r.consumed_value) }))
    .sort(byValueDesc);
  const blockedByProject: ProjectValue[] = onhandRes
    ? [...onhandRes.blockedByProject].filter(([, v]) => v > 0.5).map(([id, v]) => ({ projectId: id, label: labelFor(id), value: v })).sort(byValueDesc)
    : [];

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: "Active projects", value: formatNumber(c(activeP)) },
    { label: "Overdue POs", value: formatNumber(overduePoCount), tone: overduePoCount > 0 ? "text-red-600" : undefined },
    { label: "Untagged receipts", value: formatNumber(c(untagged)), tone: c(untagged) > 0 ? "text-amber-600" : undefined },
  ];

  const checks = [
    { label: "BOM variance", n: c(variance) },
    { label: "Untagged", n: c(untagged) },
    { label: "Missing PO", n: c(missingPo) },
    { label: "Stale stock", n: c(stale) },
    { label: "PO overdue", n: overdueLines.length },
  ];

  const costingRows = (costingRes.data ?? [])
    .map((r) => ({ ...r, consumed_value: Number(r.consumed_value ?? 0), ordered_value: Number(r.ordered_value ?? 0) }))
    .filter((r) => r.ordered_value > 0 || r.consumed_value > 0)
    .sort((a, b) => b.consumed_value - a.consumed_value)
    .slice(0, 8);

  return (
    <div>
      <PageHeader title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`} description="Live operations snapshot, straight off the ledger." />

      <section className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${onhandRes ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        {onhandRes && wipValue !== null && (
          <InventorySplitCards
            open={onhandRes.open}
            blocked={onhandRes.blocked}
            wip={wipValue}
            blockedByProject={blockedByProject}
            wipByProject={wipByProject}
          />
        )}
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${s.tone ?? ""}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Action Center</h2>
              <Link href="/reconciliation" className="text-sm text-primary hover:underline">Open →</Link>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {checks.map((ck) => (
                <Link key={ck.label} href="/reconciliation" className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:bg-accent">
                  <span className="text-sm">{ck.label}</span>
                  <Badge variant={ck.n > 0 ? "warning" : "success"}>{ck.n}</Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Project costing {finance ? "" : "(restricted)"}</h2>
            {!finance ? (
              <p className="text-sm text-muted-foreground">Cost figures are hidden for your role.</p>
            ) : costingRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No procurement/consumption yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Project</TableHead><TableHead>Budgeted Cost</TableHead><TableHead>Ordered</TableHead><TableHead>WIP</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {costingRows.map((r) => (
                    <TableRow key={r.project_id}>
                      <TableCell className="font-medium">
                        <Link href={`/projects/${r.project_id}`} className="text-primary hover:underline">{r.project_no}</Link>
                        {custName.get(custIdByProject.get(r.project_id) ?? "") && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">— {custName.get(custIdByProject.get(r.project_id) ?? "")}</span>
                        )}
                      </TableCell>
                      <TableCell>{formatINR(r.customer_po_value)}</TableCell>
                      <TableCell>{formatINR(r.ordered_value)}</TableCell>
                      <TableCell>{formatINR(r.consumed_value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Master data</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "BOM Builder", href: "/masters/bom-builder" },
            { label: "Components", href: "/masters/components" },
            { label: "Vendors", href: "/masters/vendors" },
          ].map((m) => (
            <Link key={m.label} href={m.href} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent">{m.label}</Link>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Shelf stock at the PO rate, split by lot status: "open" is free stock,
 * "issued" is blocked for a project (also totalled per project). Raw material
 * out with a job-work vendor counts as blocked for the order's project: it
 * isn't consumed until the completed piece is used. Paged, because there are
 * well over the 1,000 rows PostgREST returns per request and it truncates
 * silently.
 */
async function shelfStockByStatus(supabase: Awaited<ReturnType<typeof createClient>>) {
  const [rates, lots, jwOrders] = await Promise.all([
    readAll((from, to) =>
      supabase.from("v_lot_rates").select("lot_id, status, qty_on_hand, rate")
        .in("status", ["open", "issued"]).gt("qty_on_hand", 0).order("lot_id").range(from, to)),
    readAll((from, to) =>
      supabase.from("inventory_lots").select("id, project_id")
        .eq("status", "issued").gt("qty_on_hand", 0).order("id").range(from, to)),
    readAll((from, to) =>
      supabase.from("job_work_orders").select("id, project_id, job_work_lines(raw_lot_id, qty_sent, qty_returned)")
        .in("status", ["sent", "partial"]).order("id").range(from, to)),
  ]);
  const atVendor = jwOrders.flatMap((o) =>
    (o.job_work_lines ?? []).map((l) => ({
      projectId: o.project_id,
      rawLotId: l.raw_lot_id,
      qty: Math.max(Number(l.qty_sent ?? 0) - Number(l.qty_returned ?? 0), 0),
    })),
  ).filter((l) => l.qty > 0 && l.rawLotId);
  const rawRates = atVendor.length
    ? await supabase.from("v_lot_rates").select("lot_id, rate").in("lot_id", [...new Set(atVendor.map((l) => l.rawLotId!))])
    : { data: [] };
  const rawRate = new Map((rawRates.data ?? []).map((r) => [r.lot_id, Number(r.rate ?? 0)]));
  const projectByLot = new Map(lots.map((l) => [l.id, l.project_id]));
  const totals = { open: 0, blocked: 0, blockedByProject: new Map<string, number>() };
  for (const r of rates) {
    const v = Number(r.qty_on_hand ?? 0) * Number(r.rate ?? 0);
    if (r.status === "open") { totals.open += v; continue; }
    totals.blocked += v;
    const pid = r.lot_id ? projectByLot.get(r.lot_id) : null;
    if (pid) totals.blockedByProject.set(pid, (totals.blockedByProject.get(pid) ?? 0) + v);
  }
  for (const l of atVendor) {
    const v = l.qty * (rawRate.get(l.rawLotId!) ?? 0);
    totals.blocked += v;
    if (l.projectId) totals.blockedByProject.set(l.projectId, (totals.blockedByProject.get(l.projectId) ?? 0) + v);
  }
  return totals;
}

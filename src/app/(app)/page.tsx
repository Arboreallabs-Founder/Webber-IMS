import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatINR, formatNumber } from "@/lib/utils";

export default async function DashboardPage() {
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const [activeP, openPo, overdue, untagged, missingPo, stale, variance, costingRes, onhandRes, inStockLots, projectsRes, customersRes] =
    await Promise.all([
      supabase.from("projects").select("*", { count: "exact", head: true }).neq("status", "closed"),
      supabase.from("po_lines").select("*", { count: "exact", head: true }).in("line_status", ["pending", "partial"]),
      supabase.from("v_po_overdue").select("*", { count: "exact", head: true }),
      supabase.from("v_untagged_receipts").select("*", { count: "exact", head: true }),
      supabase.from("v_missing_po").select("*", { count: "exact", head: true }),
      supabase.from("v_stale_stock").select("*", { count: "exact", head: true }),
      supabase.from("v_bom_variance").select("*", { count: "exact", head: true }).or("uncovered_qty.gt.0,receive_gap.gt.0"),
      supabase.from("v_project_costing").select("*"),
      finance ? supabase.from("v_component_on_hand").select("stock_value") : Promise.resolve({ data: [] }),
      // Open + issued(blocked) stock only — a component sitting at 'consumed'
      // shouldn't count as "in inventory" even if some other lot's rounding
      // left it a stray non-zero qty_on_hand.
      supabase.from("inventory_lots").select("component_id").in("status", ["open", "issued"]).gt("qty_on_hand", 0),
      supabase.from("projects").select("id, customer_id"),
      getCustomers(),
    ]);

  const custName = new Map(customersRes.map((c) => [c.id, c.name]));
  const custIdByProject = new Map((projectsRes.data ?? []).map((p) => [p.id, p.customer_id]));

  const c = (r: { count: number | null }) => r.count ?? 0;
  const stockValue = finance ? (onhandRes.data ?? []).reduce((s, r) => s + Number((r as { stock_value?: number }).stock_value ?? 0), 0) : null;
  const componentsInStock = new Set((inStockLots.data ?? []).map((l) => l.component_id)).size;

  const stats: { label: string; value: string; tone?: string; href?: string }[] = [
    ...(stockValue !== null ? [{ label: "Live stock value", value: formatINR(stockValue) }] : []),
    { label: "Components in inventory", value: formatNumber(componentsInStock), href: "/inventory" },
    { label: "Active projects", value: formatNumber(c(activeP)) },
    { label: "Open PO lines", value: formatNumber(c(openPo)) },
    { label: "Overdue POs", value: formatNumber(c(overdue)), tone: c(overdue) > 0 ? "text-red-600" : undefined },
    { label: "Untagged receipts", value: formatNumber(c(untagged)), tone: c(untagged) > 0 ? "text-amber-600" : undefined },
  ];

  const checks = [
    { label: "BOM variance", n: c(variance) },
    { label: "Untagged", n: c(untagged) },
    { label: "Missing PO", n: c(missingPo) },
    { label: "Stale stock", n: c(stale) },
    { label: "PO overdue", n: c(overdue) },
  ];

  const costingRows = (costingRes.data ?? [])
    .map((r) => ({ ...r, consumed_value: Number(r.consumed_value ?? 0), ordered_value: Number(r.ordered_value ?? 0) }))
    .filter((r) => r.ordered_value > 0 || r.consumed_value > 0)
    .sort((a, b) => b.consumed_value - a.consumed_value)
    .slice(0, 8);

  return (
    <div>
      <PageHeader title={`Welcome${profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`} description="Live operations snapshot, straight off the ledger." />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => {
          const card = (
            <Card className={s.href ? "h-full transition-colors hover:border-primary/50 hover:bg-accent/40" : undefined}>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
                <p className={`mt-1 text-2xl font-semibold ${s.tone ?? ""}`}>{s.value}</p>
              </CardContent>
            </Card>
          );
          return s.href ? (
            <Link key={s.label} href={s.href}>
              {card}
            </Link>
          ) : (
            <div key={s.label}>{card}</div>
          );
        })}
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

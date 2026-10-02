import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatDate, formatNumber } from "@/lib/utils";
import { RequisitionEditor } from "./requisition-editor";
import { ScanConsume } from "./scan-consume";

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const role = profile?.role;
  const canProcure = role === "admin" || role === "team_lead" || role === "inventory_admin";
  const canRequest = canProcure || role === "team_member";
  const supabase = await createClient();

  const { data: req } = await supabase.from("requisitions").select("*").eq("id", id).single();
  if (!req) notFound();

  const [{ data: lines }, { data: components }, project, { data: movements }] = await Promise.all([
    supabase.from("requisition_lines").select("*").eq("requisition_id", id).order("created_at"),
    supabase.from("components").select("id, component_no, name").order("component_no"),
    req.project_id
      ? supabase.from("projects").select("project_no, is_internal, department, consumption_reason").eq("id", req.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("stock_movements")
      .select("id, lot_id, component_id, qty, note, performed_at")
      .eq("reference_type", "requisition")
      .eq("reference_id", id)
      .order("performed_at", { ascending: false }),
  ]);

  const compLabel = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));

  // How much of each component has actually been scanned & consumed so far —
  // powers the tick mark on each requested line as it gets fulfilled.
  const consumedQtyByComponent = new Map<string, number>();
  for (const m of movements ?? []) {
    if (!m.component_id) continue;
    const qty = Math.abs(Number(m.qty ?? 0));
    consumedQtyByComponent.set(m.component_id, (consumedQtyByComponent.get(m.component_id) ?? 0) + qty);
  }

  const lineRows = (lines ?? []).map((l) => ({
    id: l.id,
    component_label: l.component_id ? compLabel.get(l.component_id) ?? "—" : "—",
    qty: l.qty,
    consumed: l.component_id ? consumedQtyByComponent.get(l.component_id) ?? 0 : 0,
  }));

  // How much of each requested component is still outstanding on this
  // requisition — drives the auto-filled, locked "Qty to consume" in
  // Scan to consume, so it can never go over what's actually requested.
  const remainingByComponent: Record<string, number> = {};
  for (const l of lines ?? []) {
    if (!l.component_id) continue;
    const consumed = consumedQtyByComponent.get(l.component_id) ?? 0;
    remainingByComponent[l.component_id] = Math.max(Number(l.qty ?? 0) - consumed, 0);
  }

  const consumedLotIds = [...new Set((movements ?? []).map((m) => m.lot_id).filter(Boolean))] as string[];
  const { data: consumedLots } = consumedLotIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code, source_lot_id").in("id", consumedLotIds)
    : { data: [] };
  // A reserved slice has no sticker — what was actually scanned was the box
  // it sits in, so name that box alongside it.
  const boxIds = [...new Set((consumedLots ?? []).map((l) => l.source_lot_id).filter(Boolean))] as string[];
  const { data: boxLots } = boxIds.length
    ? await supabase.from("inventory_lots").select("id, lot_code").in("id", boxIds)
    : { data: [] };
  const boxCode = new Map((boxLots ?? []).map((b) => [b.id, b.lot_code]));
  const lotCode = new Map((consumedLots ?? []).map((l) => [
    l.id,
    l.source_lot_id && boxCode.has(l.source_lot_id) ? `${l.lot_code} (in ${boxCode.get(l.source_lot_id)})` : l.lot_code,
  ]));
  const consumedRows = (movements ?? []).map((m) => ({
    id: m.id,
    component_label: m.component_id ? compLabel.get(m.component_id) ?? "—" : "—",
    qty: Math.abs(Number(m.qty ?? 0)),
    lot_code: m.lot_id ? lotCode.get(m.lot_id) ?? null : null,
    lot_id: m.lot_id,
    note: m.note,
    performed_at: m.performed_at,
  }));

  // Scan-to-consume: any requester role on a project requisition; admin-only
  // (with a mandatory reason) on a stock requisition — see `consumeLot`.
  const canScan = req.project_id ? canRequest : role === "admin";

  return (
    <div>
      <Link href="/requisitions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All requisitions
      </Link>
      <PageHeader
        title={req.req_no}
        description={
          project?.data?.is_internal
            ? `Internal consumption — ${project.data.project_no}` +
              ([project.data.department, project.data.consumption_reason].filter(Boolean).length
                ? ` (${[project.data.department, project.data.consumption_reason].filter(Boolean).join(" — ")})`
                : "")
            : project?.data?.project_no
            ? `Project ${project.data.project_no}`
            : "Stock requisition"
        }
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <RequisitionEditor
            requisitionId={id}
            status={req.status}
            lines={lineRows}
            canProcure={canProcure}
            canRequest={canRequest}
          />
        </CardContent>
      </Card>

      {canScan && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Receive &amp; consume
          </h2>
          <ScanConsume
            requisitionId={id}
            projectId={req.project_id}
            projectNo={project?.data?.project_no ?? null}
            requireReason={!req.project_id}
            requiredByComponent={remainingByComponent}
          />
        </>
      )}

      {consumedRows.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Issued in this requisition
          </h2>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Lot (QR)</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consumedRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.component_label}</TableCell>
                    <TableCell>{formatNumber(r.qty)}</TableCell>
                    <TableCell>
                      {r.lot_code && r.lot_id
                        ? <Link href={`/inventory/lots/${r.lot_id}`} className="font-mono text-xs text-primary hover:underline">{r.lot_code}</Link>
                        : (r.lot_code ?? "—")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.performed_at)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 sm:hidden">
            {consumedRows.map((r) => (
              <MobileRowCard
                key={r.id}
                title={r.component_label}
                subtitle={formatDate(r.performed_at)}
                fields={[
                  { label: "Qty", value: formatNumber(r.qty) },
                  {
                    label: "Lot (QR)",
                    value: r.lot_code && r.lot_id
                      ? <Link href={`/inventory/lots/${r.lot_id}`} className="font-mono text-xs text-primary hover:underline">{r.lot_code}</Link>
                      : (r.lot_code ?? "—"),
                  },
                ]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

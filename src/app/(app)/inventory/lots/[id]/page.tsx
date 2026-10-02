import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { QrCode } from "@/components/qr-code";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { formatNumber, formatDate, formatINR, projectLabel } from "@/lib/utils";
import { LotActions } from "./lot-actions";
import { ReverseConsumptionButton } from "./reverse-consumption-button";

const MOVE_LABEL: Record<string, string> = {
  receipt: "Receipt", issue: "Issue", adjustment: "Adjustment", transfer: "Transfer", return: "Return",
};

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const canManage = profile?.role === "admin" || profile?.role === "team_lead" || profile?.role === "inventory_admin";
  const isAdmin = profile?.role === "admin";
  const supabase = await createClient();

  const { data: lot } = await supabase.from("inventory_lots").select("*").eq("id", id).single();
  if (!lot) notFound();

  const [{ data: comp }, { data: vendor }, { data: project }, { data: moves }, { data: projects }, { data: parentLot }, customers, { data: mpnRows }, { data: boxLot }, { data: slices }] =
    await Promise.all([
      lot.component_id ? supabase.from("components").select("component_no, name").eq("id", lot.component_id).maybeSingle() : Promise.resolve({ data: null }),
      lot.vendor_id ? supabase.from("vendors").select("name").eq("id", lot.vendor_id).maybeSingle() : Promise.resolve({ data: null }),
      lot.project_id ? supabase.from("projects").select("project_no, customer_id").eq("id", lot.project_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("stock_movements").select("*").eq("lot_id", id).order("performed_at", { ascending: false }),
      supabase.from("projects").select("id, project_no, customer_id").order("project_no"),
      lot.parent_lot_id ? supabase.from("inventory_lots").select("id, lot_code").eq("id", lot.parent_lot_id).maybeSingle() : Promise.resolve({ data: null }),
      getCustomers(),
      // A box can genuinely hold more than one MPN mixed together.
      supabase.from("inventory_lot_mpns").select("qty, component_mpns(mpn)").eq("lot_id", id).order("qty", { ascending: false }),
      // A reserved slice: the box it physically sits in (the sticker to scan).
      lot.source_lot_id ? supabase.from("inventory_lots").select("id, lot_code").eq("id", lot.source_lot_id).maybeSingle() : Promise.resolve({ data: null }),
      // A box: the parts reserved inside it.
      supabase.from("inventory_lots").select("id, lot_code, qty_on_hand, status, project_id").eq("source_lot_id", id).gt("qty_on_hand", 0).order("created_at"),
    ]);
  const isBox = !!lot.container_no;
  const isSlice = !!lot.source_lot_id;
  // An emptied slice whose last movement handed its stock back to the box —
  // "consumed" would be the wrong word for stock that was returned.
  const returnedToOpen = isSlice && lot.status === "consumed" && moves?.[0]?.reference_type === "reservation_release";
  const insideQty = (slices ?? []).reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
  const mpnBreakdown = (mpnRows ?? []).map((r) => {
    const mpnRow = r.component_mpns as unknown as { mpn: string } | { mpn: string }[] | null;
    return { label: (Array.isArray(mpnRow) ? mpnRow[0]?.mpn : mpnRow?.mpn) ?? "—", qty: Number(r.qty ?? 0) };
  });

  // Every MPN this component has ever been registered under, plus how much of
  // each has been received across ALL of its lots (not just this one) — so
  // opening any single lot shows the full picture for its WPC. This is a
  // received-quantity tally, not live remaining stock: consumption is tracked
  // per lot, not broken down by MPN within a lot.
  const [{ data: allMpnsForComponent }, { data: allMpnQtyRows }] = lot.component_id
    ? await Promise.all([
        supabase.from("component_mpns").select("id, mpn").eq("component_id", lot.component_id).order("mpn"),
        supabase
          .from("inventory_lot_mpns")
          .select("mpn_id, qty, inventory_lots!inner(component_id)")
          .eq("inventory_lots.component_id", lot.component_id),
      ])
    : [{ data: [] }, { data: [] }];
  const receivedByMpn = new Map<string, number>();
  for (const r of allMpnQtyRows ?? []) {
    receivedByMpn.set(r.mpn_id, (receivedByMpn.get(r.mpn_id) ?? 0) + Number(r.qty ?? 0));
  }
  const allMpnsBreakdown = (allMpnsForComponent ?? [])
    .map((m) => ({ id: m.id, label: m.mpn, qty: receivedByMpn.get(m.id) ?? 0 }))
    .sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label));

  const issueMoveIds = (moves ?? []).filter((m) => m.movement_type === "issue").map((m) => m.id);
  const { data: reversals } = isAdmin && issueMoveIds.length
    ? await supabase.from("stock_movements").select("reference_id").eq("reference_type", "consumption_reversal").in("reference_id", issueMoveIds)
    : { data: [] };
  const reversedIds = new Set((reversals ?? []).map((r) => r.reference_id));

  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const projectsWithCustomer = (projects ?? []).map((p) => ({ ...p, customer_name: p.customer_id ? custName.get(p.customer_id) ?? null : null }));
  const projNo = new Map(projectsWithCustomer.map((p) => [p.id, projectLabel(p)]));
  const projectDisplay = project ? projectLabel({ project_no: project.project_no, customer_name: project.customer_id ? custName.get(project.customer_id) ?? null : null }) : undefined;

  return (
    <div>
      <Link href={lot.component_id ? `/inventory/${lot.component_id}` : "/inventory"} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {comp ? `${comp.component_no} lots` : "Inventory"}
      </Link>
      <PageHeader
        title={comp ? `${comp.component_no} — ${comp.name}` : "Lot"}
        description={lot.lot_code}
        action={
          isSlice ? undefined : (
            <Link href={`/inventory/stickers?lots=${lot.id}`} className={buttonVariants({ variant: "outline" })}>
              Print sticker
            </Link>
          )
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-3">
            <Info label="On hand" value={formatNumber(lot.qty_on_hand)} />
            <Info label="Initial" value={formatNumber(lot.qty_initial)} />
            <Info label="Status" value={returnedToOpen ? "Returned to open inventory" : lot.status} />
            {insideQty > 0 && <Info label="Reserved inside" value={formatNumber(insideQty)} />}
            {lot.jw_stage && <Info label="Job-work stage" value={lot.jw_stage === "raw" ? "Raw (needs job work)" : "Completed"} />}
            {isBox && <Info label="Box" value={lot.container_no} />}
            <Info label="Location" value={lot.location} />
            <Info label="Vendor" value={vendor?.name} />
            <Info label="Project" value={projectDisplay} />
            {finance && <Info label="Unit cost" value={formatINR(lot.unit_cost)} />}
            <Info label="Received" value={formatDate(lot.created_at)} />
          </CardContent>
        </Card>
        {/*
          The QR still encodes the bare lot code — the scanner hands whatever it
          reads straight to exact-match lookups (traceability, and consuming
          against a requisition), so the payload must not become a URL. Only the
          card around it links anywhere. The "View traceability" line is there
          because a QR image gives no hint that it is pressable.
        */}
        {/* A reserved slice has no sticker: it's a part of a box, found by
            scanning that box — so no QR here, just the box to scan. */}
        {isSlice ? (
          <Card>
            <CardContent className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center text-sm">
              <p className="text-muted-foreground">Reserved part of a box — no sticker of its own.</p>
              {boxLot ? (
                <p>
                  Scan lot{" "}
                  <Link href={`/inventory/lots/${boxLot.id}`} className="font-mono text-primary hover:underline">{boxLot.lot_code}</Link>
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Link
              href={`/traceability/${lot.lot_code}`}
              className="group flex flex-col items-center gap-2 p-5"
            >
              <QrCode value={lot.lot_code} size={140} />
              <p className="font-mono text-[11px] text-muted-foreground">{lot.lot_code}</p>
              <p className="text-sm font-medium text-primary group-hover:underline">
                View traceability →
              </p>
            </Link>
          </Card>
        )}
      </div>

      {(slices ?? []).length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reserved inside this box</p>
            <div className="flex flex-wrap gap-2">
              {(slices ?? []).map((s) => (
                <Link key={s.id} href={`/inventory/lots/${s.id}`}>
                  <Badge variant={s.status === "issued" ? "warning" : "secondary"}>
                    {s.status === "issued" && s.project_id ? projNo.get(s.project_id) ?? "—" : "Open"} × {formatNumber(s.qty_on_hand)}
                  </Badge>
                </Link>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Scanning this box on a project&apos;s requisition uses that project&apos;s reserved part first, then the open stock.
            </p>
          </CardContent>
        </Card>
      )}

      {(mpnBreakdown.length > 0 || allMpnsBreakdown.length > 0) && (
        <Card className="mb-6">
          <CardContent className="space-y-4 p-5">
            {mpnBreakdown.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">In this box</p>
                <div className="flex flex-wrap gap-2">
                  {mpnBreakdown.map((m) => (
                    <Badge key={m.label} variant="secondary">{m.label} × {formatNumber(m.qty)}</Badge>
                  ))}
                </div>
              </div>
            )}
            {allMpnsBreakdown.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All MPNs for this component</p>
                <div className="flex flex-wrap gap-2">
                  {allMpnsBreakdown.map((m) => (
                    <Badge key={m.id} variant={m.qty > 0 ? "secondary" : "outline"}>
                      {m.label}{m.qty > 0 ? ` × ${formatNumber(m.qty)}` : " — none received"}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Total received across every lot of this component, not just this one — and not adjusted for what's since been consumed.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {parentLot && (
        <p className="mb-4 text-sm text-muted-foreground">
          Completed via job work from raw lot{" "}
          <Link href={`/inventory/lots/${parentLot.id}`} className="font-mono text-primary hover:underline">{parentLot.lot_code}</Link>.
        </p>
      )}

      {/* Stock-take and transfer happen on the box; a slice moves and is
          counted with it. */}
      {!isSlice && (
        <>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Actions</h2>
          <Card className="mb-8"><CardContent className="p-5">
            <LotActions lotId={id} qtyOnHand={Number(lot.qty_on_hand ?? 0) + insideQty} canManage={canManage} />
          </CardContent></Card>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ledger (immutable)</h2>
      {(moves ?? []).length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">No movements.</p>
      ) : (
        <>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Movement</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Ref</TableHead>
                  {isAdmin && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(moves ?? []).map((m) => {
                  const reversible = m.movement_type === "issue" && m.reference_type !== "job_work" && !reversedIds.has(m.id);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">{formatDate(m.performed_at)}</TableCell>
                      <TableCell><Badge variant={m.movement_type === "issue" ? "warning" : "secondary"}>{MOVE_LABEL[m.movement_type] ?? m.movement_type}</Badge></TableCell>
                      <TableCell className={Number(m.qty) < 0 ? "text-red-600" : "text-green-700"}>{Number(m.qty) > 0 ? "+" : ""}{formatNumber(m.qty)}</TableCell>
                      <TableCell className="text-muted-foreground">{m.project_id ? projNo.get(m.project_id) ?? "—" : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.reference_type === "requisition" && m.reference_id
                          ? <Link href={`/requisitions/${m.reference_id}`} className="text-primary hover:underline">requisition</Link>
                          : (m.reference_type ?? "—")}
                      </TableCell>
                      {isAdmin && <TableCell>{reversible && <ReverseConsumptionButton movementId={m.id} />}</TableCell>}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-3 sm:hidden">
            {(moves ?? []).map((m) => {
              const reversible = m.movement_type === "issue" && m.reference_type !== "job_work" && !reversedIds.has(m.id);
              return (
                <MobileRowCard
                  key={m.id}
                  title={MOVE_LABEL[m.movement_type] ?? m.movement_type}
                  subtitle={formatDate(m.performed_at)}
                  badge={<Badge variant={m.movement_type === "issue" ? "warning" : "secondary"}>{m.reference_type ?? "—"}</Badge>}
                  fields={[
                    { label: "Qty", value: <span className={Number(m.qty) < 0 ? "text-red-600" : "text-green-700"}>{Number(m.qty) > 0 ? "+" : ""}{formatNumber(m.qty)}</span> },
                    { label: "Project", value: m.project_id ? projNo.get(m.project_id) ?? "—" : "—" },
                    ...(isAdmin && reversible ? [{ label: "Action", value: <ReverseConsumptionButton movementId={m.id} /> }] : []),
                  ]}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}

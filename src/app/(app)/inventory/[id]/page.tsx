import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canSeeFinancials } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { MobileRowCard } from "@/components/ui/mobile-row-card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { formatNumber, formatINR, formatDate, projectLabel } from "@/lib/utils";
import { UnissueLotButton } from "./unissue-button";

type Lot = {
  id: string; lot_code: string; qty_on_hand: string | number; qty_initial: string | number;
  location: string | null; status: string; unit_cost: number | null;
  created_at: string; project_id: string | null; vendor_id: string | null;
  piece_count: string | number | null; piece_length: string | number | null; piece_weight: string | number | null;
  source_lot_id: string | null;
};

/**
 * A reserved slice has no sticker of its own — it's found by scanning the
 * box it sits in, so the lot code is shown with that box.
 */
function LotCodeCell({ lot, boxCode }: { lot: Lot; boxCode: Map<string, string> }) {
  const box = lot.source_lot_id ? boxCode.get(lot.source_lot_id) : null;
  return (
    <span>
      {lot.lot_code}
      {box && <span className="ml-1.5 font-sans text-muted-foreground">in {box}</span>}
    </span>
  );
}

/** Renders qty with dimension breakdown for length/weight lots. */
function QtyCell({ lot, qt }: { lot: Lot; qt: string }) {
  const qty = Number(lot.qty_on_hand);
  const pc = Number(lot.piece_count) || null;
  const pl = Number(lot.piece_length) || null;
  const pweight = Number(lot.piece_weight) || null;

  if (qt === "length" && pc && pl) {
    return (
      <span>
        <span className="font-semibold">{formatNumber(qty)} m</span>
        <span className="ml-1.5 text-xs text-muted-foreground">({pc} × {pl} m)</span>
      </span>
    );
  }
  if (qt === "weight" && pc && pweight) {
    return (
      <span>
        <span className="font-semibold">{formatNumber(qty)} kg</span>
        <span className="ml-1.5 text-xs text-muted-foreground">({pc} × {formatNumber(pweight)} kg/pc)</span>
      </span>
    );
  }
  return <span className="font-semibold">{formatNumber(qty)}</span>;
}

function qtUnit(qt: string) {
  if (qt === "length") return "m";
  if (qt === "weight") return "kg";
  return "";
}

/**
 * Unwrap a PostgREST to-one embed. At runtime a many-to-one relationship comes
 * back as a single object, but the generated types widen every embed to an
 * array — so accept either shape rather than betting the page on one of them.
 */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/** The four WIP quantity buckets, summed identically for a project and for a lot. */
type Totals = { intoBuild: number; atJobWorker: number; reversed: number; net: number };

// Length and weight lots carry fractional quantities (28 such movements live),
// so a reversed consumption can leave floating-point residue like 1e-13 rather
// than a clean 0. Comparing against a tolerance stops that residue printing a
// phantom "Reversed" card or counting an emptied project as still holding stock.
// Same 1e-6 tolerance the over-receipt check uses.
const isZero = (n: number) => Math.abs(n) < 1e-6;

/**
 * The quantity columns of the WIP table. A project row and its lot rows must
 * line up cell for cell, including which optional columns are present, so they
 * render through one component rather than two copies that could drift.
 */
function QtyCells({
  row, showJobWork, showReversed, unitSuffix, muted = false,
}: {
  row: Totals; showJobWork: boolean; showReversed: boolean; unitSuffix: string; muted?: boolean;
}) {
  const qty = (n: number, prefix = "") => (isZero(n) ? "—" : `${prefix}${formatNumber(n)}${unitSuffix}`);
  return (
    <>
      <TableCell>{qty(row.intoBuild)}</TableCell>
      {showJobWork && (
        <TableCell className={!muted && !isZero(row.atJobWorker) ? "text-blue-700" : undefined}>
          {qty(row.atJobWorker)}
        </TableCell>
      )}
      {showReversed && (
        <TableCell className={!muted && !isZero(row.reversed) ? "text-green-700" : undefined}>
          {qty(row.reversed, "−")}
        </TableCell>
      )}
      <TableCell className={muted ? undefined : "font-semibold"}>
        {formatNumber(row.net)}{unitSuffix}
      </TableCell>
    </>
  );
}

export default async function ComponentInventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const isAdmin = profile?.role === "admin" || profile?.role === "team_lead" || profile?.role === "inventory_admin";
  const supabase = await createClient();

  const { data: comp } = await supabase
    .from("components")
    .select("id, component_no, name, uom, quantity_type")
    .eq("id", id)
    .single();
  if (!comp) notFound();
  const qt = (comp as { quantity_type?: string }).quantity_type ?? "nos";

  const [{ data: allLots }, { data: movements }, { data: consumptionValue }, customers] = await Promise.all([
    supabase
      .from("inventory_lots")
      // The PO a lot came from is three hops away (lot -> grn_line -> po_line ->
      // purchase_order). Fetching it as a nested embed makes PostgREST resolve
      // the whole chain inside this one request, so the WIP table's "From PO"
      // column costs no extra round trip — chaining three dependent queries
      // instead would have added ~1.2s to the page. Every FK in the chain
      // exists, and all three tables are `select using (true)`, so this resolves
      // for every role. Only `po_no` is pulled through — no rates, so the embed
      // carries nothing a non-finance role may not see.
      .select("id, lot_code, qty_on_hand, qty_initial, location, status, unit_cost, created_at, project_id, vendor_id, piece_count, piece_length, piece_weight, source_lot_id, grn_lines!inventory_lots_grn_line_id_fkey(po_lines(purchase_orders(id, po_no)))")
      .eq("component_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("stock_movements")
      .select("id, lot_id, movement_type, qty, project_id, reference_type, performed_by, performed_at")
      .eq("component_id", id)
      // 'issue' = consumed against a project; 'return' = an admin reversal of a
      // consumption. Both belong in this ledger so the quantities net out and
      // agree with the project's "Materials issued" panel.
      .in("movement_type", ["issue", "return"])
      .order("performed_at", { ascending: false })
      // These rows are summed into the WIP figures below, not just listed,
      // so the fetch must not be truncated the way a display-only list could be
      // — a short read would under-report the total and silently disagree with
      // v_project_consumption. The limit only guards against an unbounded read
      // (and against PostgREST's own default cap applying unannounced): the
      // busiest component in live data has 25 such movements. The *display*
      // list is sliced separately.
      .limit(2000),
    // Only the ₹ figure is taken from here — the quantities below are derived
    // from the ledger so the Into build / Reversed / Net columns can never
    // disagree with one another. The view already nets reversals off and
    // already prefers the approved PO rate (migrations 0062, 0069), so this is
    // the app's one valuation of consumed stock rather than a second one.
    finance
      ? supabase.from("v_project_consumption").select("project_id, consumption_value").eq("component_id", id)
      : Promise.resolve({ data: [] }),
    getCustomers(),
  ]);

  // lot id -> the PO it was received against. Read off the embed before `lots`
  // is narrowed to the hand-written Lot type below, which doesn't carry it.
  // Absent for stock with no PO trail — site purchases, job-work output lots,
  // and receipts never tagged to a PO line — which render as "—".
  const poByLot = new Map<string, { id: string; po_no: string }>();
  for (const l of allLots ?? []) {
    const po = one(one(one(l.grn_lines)?.po_lines)?.purchase_orders);
    if (po?.id && po.po_no) poByLot.set(l.id, { id: po.id, po_no: po.po_no });
  }

  const lots = (allLots ?? []) as unknown as Lot[];
  // Every slice's box is a lot of the same component, so it's already here.
  const boxCode = new Map(lots.map((l) => [l.id, l.lot_code]));
  const openLots   = lots.filter((l) => l.status === "open");
  const issuedLots = lots.filter((l) => l.status === "issued");

  const openQty   = openLots.reduce((s, l) => s + Number(l.qty_on_hand), 0);
  const issuedQty = issuedLots.reduce((s, l) => s + Number(l.qty_on_hand), 0);

  // ---- Work in progress: what is sitting in a project, per project and lot --
  // Derived from the ledger, never from lot status. A lot only reaches
  // status='consumed' once it is drained to zero, so a partially consumed lot
  // stays 'open'/'issued' — counting drained lots alone missed most of the
  // consumption (it read 0 for components with thousands of units issued).
  //
  // 'issue' rows are stored negative and 'return' rows positive, so summing
  // -qty nets reversals off automatically. That is the same definition
  // v_project_consumption uses, which keeps this page in step with the
  // Inventory export and the project pages.
  //
  // Job-work issues are split out rather than folded in: they carry a
  // project_id but the material is at a vendor being machined, not in the
  // build. They stay inside Net — the view counts them, and netting them out
  // here would make this page quietly disagree with everywhere else.
  //
  // Grouped two levels deep — project, then the individual lots that went into
  // it. Every issue/return row carries a lot_id (verified across the whole
  // ledger), so no movement falls outside a lot, and a project row therefore
  // always has at least one lot row under it.
  type WipLot     = Totals & { lotId: string };
  type WipProject = Totals & { projectId: string; lots: Map<string, WipLot> };

  const zero = (): Totals => ({ intoBuild: 0, atJobWorker: 0, reversed: 0, net: 0 });
  // One movement contributes identically to its lot and to its project, so the
  // two levels can never drift apart.
  function add(t: Totals, m: { movement_type: string; reference_type: string | null; qty: number | string | null }) {
    const signed = Number(m.qty ?? 0);          // stored: issue negative, return positive
    if (m.movement_type === "return") t.reversed += signed;
    else if (m.reference_type === "job_work") t.atJobWorker += -signed;
    else t.intoBuild += -signed;
    t.net += -signed;
  }

  const wipByProject = new Map<string, WipProject>();
  for (const m of movements ?? []) {
    if (!m.project_id) continue;
    let proj = wipByProject.get(m.project_id);
    if (!proj) {
      proj = { projectId: m.project_id, ...zero(), lots: new Map() };
      wipByProject.set(m.project_id, proj);
    }
    add(proj, m);

    if (!m.lot_id) continue;
    let lot = proj.lots.get(m.lot_id);
    if (!lot) {
      lot = { lotId: m.lot_id, ...zero() };
      proj.lots.set(m.lot_id, lot);
    }
    add(lot, m);
  }

  const hasActivity = (t: Totals) => !isZero(t.intoBuild) || !isZero(t.atJobWorker) || !isZero(t.reversed);

  // A project that nets to zero *after* a reversal is kept — "we issued 380 and
  // took it all back" is worth seeing. Only rows with no activity at all go.
  const wipRows = [...wipByProject.values()]
    .filter(hasActivity)
    .map((p) => ({ ...p, lotRows: [...p.lots.values()].filter(hasActivity).sort((a, b) => b.net - a.net) }))
    .sort((a, b) => b.net - a.net);

  const consumedQty  = wipRows.reduce((s, r) => s + r.net, 0);
  const reversedQty  = wipRows.reduce((s, r) => s + r.reversed, 0);
  const jobWorkerQty = wipRows.reduce((s, r) => s + r.atJobWorker, 0);
  // A fully-reversed project still earns a table row, but it is not a project
  // the material is sitting in — so it doesn't count towards "across N projects".
  const projectsHolding = wipRows.filter((r) => !isZero(r.net)).length;
  const showReversed = !isZero(reversedQty);
  const showJobWork  = !isZero(jobWorkerQty);

  const valueByProject = new Map(
    (consumptionValue ?? []).map((v) => [v.project_id, Number(v.consumption_value ?? 0)]),
  );

  const allProjectIds = [...new Set([
    ...lots.map((l) => l.project_id),
    ...(movements ?? []).map((m) => m.project_id),
  ].filter(Boolean))];
  const { data: projects } = allProjectIds.length
    ? await supabase.from("projects").select("id, project_no, customer_id").in("id", allProjectIds)
    : { data: [] };
  const custName = new Map(customers.map((c) => [c.id, c.name]));
  const projNo = new Map((projects ?? []).map((p) => [p.id, p.project_no]));
  // Full "PO-123 — Customer" label for the consumed table; the compact badges in
  // the lot tables keep the bare project_no they already show.
  const projFull = new Map(
    (projects ?? []).map((p) => [
      p.id,
      projectLabel({ project_no: p.project_no, customer_name: p.customer_id ? custName.get(p.customer_id) ?? null : null }),
    ]),
  );

  // The aggregate above reads every movement; the list below is capped so a
  // component with a very long ledger can't render an unbounded table.
  const allMovements = movements ?? [];
  const historyRows = allMovements.slice(0, 200);

  const performerIds = [...new Set((movements ?? []).map((m) => m.performed_by).filter(Boolean))];
  const { data: perfProfiles } = performerIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", performerIds)
    : { data: [] };
  const perfName = new Map((perfProfiles ?? []).map((p) => [p.id, p.full_name]));
  const lotCode  = new Map(lots.map((l) => [l.id, l.lot_code]));

  const unit = qtUnit(qt);
  const unitSuffix = unit ? ` ${unit}` : "";
  // Which optional columns exist is decided once, so a project row and its lot
  // rows can never disagree about the shape of the table.
  const qtyCellProps = { showJobWork, showReversed, unitSuffix };

  return (
    <div>
      <Link href="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All inventory
      </Link>

      <PageHeader
        title={`${comp.component_no} — ${comp.name}`}
        description={[
          comp.uom ? `Unit: ${comp.uom}` : null,
          qt !== "nos" ? (qt === "length" ? "Lot type: Length (metres)" : "Lot type: Weight (KG)") : null,
        ].filter(Boolean).join(" · ") || undefined}
      />

      {/* Summary */}
      <div className={`mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 ${showReversed ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Open</p>
            <p className="mt-1 text-2xl font-bold text-green-700">{formatNumber(openQty)}{unitSuffix}</p>
            <p className="text-xs text-muted-foreground">{openLots.length} lot{openLots.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Issued (frozen)</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{formatNumber(issuedQty)}{unitSuffix}</p>
            <p className="text-xs text-muted-foreground">{issuedLots.length} lot{issuedLots.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">WIP (in projects)</p>
            <p className="mt-1 text-2xl font-bold text-muted-foreground">{formatNumber(consumedQty)}{unitSuffix}</p>
            <p className="text-xs text-muted-foreground">
              across {projectsHolding} project{projectsHolding !== 1 ? "s" : ""}
              {showJobWork && ` · ${formatNumber(jobWorkerQty)}${unitSuffix} at job worker`}
            </p>
          </CardContent>
        </Card>
        {/* Only shown when a reversal has actually happened, so the usual case
            stays three cards. */}
        {showReversed && (
          <Card>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Reversed</p>
              <p className="mt-1 text-2xl font-bold text-green-700">{formatNumber(reversedQty)}{unitSuffix}</p>
              <p className="text-xs text-muted-foreground">returned to stock</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Open lots */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open inventory</h2>
        {openLots.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No open lots.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot code</TableHead>
                    <TableHead>On hand</TableHead>
                    <TableHead>Location</TableHead>
                    {finance && <TableHead>Unit cost{unit ? ` (₹/${unit})` : ""}</TableHead>}
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openLots.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs"><LotCodeCell lot={l} boxCode={boxCode} /></TableCell>
                      <TableCell><QtyCell lot={l} qt={qt} /></TableCell>
                      <TableCell className="text-muted-foreground">{l.location ?? "—"}</TableCell>
                      {finance && <TableCell className="text-muted-foreground">{formatINR(l.unit_cost)}</TableCell>}
                      <TableCell className="text-right">
                        <Link href={`/inventory/lots/${l.id}`} aria-label="Lot detail" className={buttonVariants({ variant: "ghost", size: "icon" })}>
                          <ArrowRight className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 sm:hidden">
              {openLots.map((l) => (
                <Link key={l.id} href={`/inventory/lots/${l.id}`} className="block">
                  <MobileRowCard
                    title={<LotCodeCell lot={l} boxCode={boxCode} />}
                    fields={[
                      { label: "On hand", value: <QtyCell lot={l} qt={qt} /> },
                      { label: "Location", value: l.location ?? "—" },
                      ...(finance ? [{ label: `Unit cost${unit ? ` (₹/${unit})` : ""}`, value: formatINR(l.unit_cost) }] : []),
                    ]}
                  />
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Issued lots */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Issued inventory <span className="ml-1 font-normal normal-case text-amber-600">(frozen under a project)</span>
        </h2>
        {issuedLots.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No issued lots.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot code</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Location</TableHead>
                    {finance && <TableHead>Unit cost{unit ? ` (₹/${unit})` : ""}</TableHead>}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issuedLots.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs"><LotCodeCell lot={l} boxCode={boxCode} /></TableCell>
                      <TableCell className="text-amber-700"><QtyCell lot={l} qt={qt} /></TableCell>
                      <TableCell>
                        {l.project_id
                          ? <Badge variant="secondary">{projNo.get(l.project_id) ?? "—"}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.location ?? "—"}</TableCell>
                      {finance && <TableCell className="text-muted-foreground">{formatINR(l.unit_cost)}</TableCell>}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isAdmin && <UnissueLotButton lotId={l.id} componentId={id} qtyOnHand={Number(l.qty_on_hand)} />}
                          <Link href={`/inventory/lots/${l.id}`} aria-label="Lot detail" className={buttonVariants({ variant: "ghost", size: "icon" })}>
                            <ArrowRight className="size-4" />
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 sm:hidden">
              {issuedLots.map((l) => (
                <MobileRowCard
                  key={l.id}
                  title={<LotCodeCell lot={l} boxCode={boxCode} />}
                  badge={l.project_id ? <Badge variant="secondary">{projNo.get(l.project_id) ?? "—"}</Badge> : undefined}
                  fields={[
                    { label: "Qty", value: <span className="text-amber-700"><QtyCell lot={l} qt={qt} /></span> },
                    { label: "Location", value: l.location ?? "—" },
                    ...(finance ? [{ label: `Unit cost${unit ? ` (₹/${unit})` : ""}`, value: formatINR(l.unit_cost) }] : []),
                  ]}
                  actions={
                    <>
                      {isAdmin && <UnissueLotButton lotId={l.id} componentId={id} qtyOnHand={Number(l.qty_on_hand)} />}
                      <Link href={`/inventory/lots/${l.id}`} aria-label="Lot detail" className={buttonVariants({ variant: "ghost", size: "icon" })}>
                        <ArrowRight className="size-4" />
                      </Link>
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}
        {isAdmin && issuedLots.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Unissuing a lot (all or part of it) removes its project reservation and returns it to open stock — a
            reserved part of a box goes back into that box.
          </p>
        )}
      </section>

      {/* Work in progress — what is in the projects right now, lot by lot */}
      <section className="mb-10">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Work in Progress (WIP)
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Net of reversals. Reversed material is not counted here — it is in the history below.
        </p>
        {wipRows.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">Nothing in progress yet.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project / lot</TableHead>
                    <TableHead>From PO</TableHead>
                    <TableHead>Into build</TableHead>
                    {showJobWork && <TableHead>At job worker</TableHead>}
                    {showReversed && <TableHead>Reversed</TableHead>}
                    <TableHead>Net in project</TableHead>
                    {finance && <TableHead>Value</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wipRows.map((r) => (
                    // A project and its lots are one visual group, so they share a
                    // fragment rather than each project rendering its own table.
                    <Fragment key={r.projectId}>
                      <TableRow>
                        <TableCell>
                          <Link href={`/projects/${r.projectId}`} className="font-medium text-primary hover:underline">
                            {projFull.get(r.projectId) ?? "—"}
                          </Link>
                        </TableCell>
                        {/* The PO belongs to a lot, not to the project — a project
                            row can span several POs, so it stays blank here. */}
                        <TableCell />
                        <QtyCells row={r} {...qtyCellProps} />
                        {finance && (
                          <TableCell className="text-muted-foreground">{formatINR(valueByProject.get(r.projectId) ?? null)}</TableCell>
                        )}
                      </TableRow>
                      {r.lotRows.map((l) => (
                        <TableRow key={l.lotId} className="text-muted-foreground">
                          <TableCell className="pl-8 font-mono text-xs">
                            <Link href={`/inventory/lots/${l.lotId}`} className="text-primary hover:underline">
                              {lotCode.get(l.lotId) ?? "—"}
                            </Link>
                          </TableCell>
                          <TableCell className="text-xs">
                            {poByLot.has(l.lotId) ? (
                              <Link href={`/purchase-orders/${poByLot.get(l.lotId)!.id}`} className="text-primary hover:underline">
                                {poByLot.get(l.lotId)!.po_no}
                              </Link>
                            ) : "—"}
                          </TableCell>
                          <QtyCells row={l} {...qtyCellProps} muted />
                          {finance && <TableCell />}
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                  <TableRow className="border-t-2">
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell />
                    <TableCell />
                    {showJobWork && <TableCell />}
                    {showReversed && <TableCell />}
                    <TableCell className="font-bold">{formatNumber(consumedQty)}{unitSuffix}</TableCell>
                    {finance && (
                      <TableCell className="font-semibold">
                        {formatINR(wipRows.reduce((s, r) => s + (valueByProject.get(r.projectId) ?? 0), 0))}
                      </TableCell>
                    )}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {/* MobileRowCard can't nest, so each project becomes a heading line
                with its own lot cards underneath. */}
            <div className="space-y-6 sm:hidden">
              {wipRows.map((r) => (
                <div key={r.projectId} className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1">
                    <Link href={`/projects/${r.projectId}`} className="text-sm font-medium text-primary hover:underline">
                      {projFull.get(r.projectId) ?? "—"}
                    </Link>
                    <span className="shrink-0 text-sm font-bold">{formatNumber(r.net)}{unitSuffix}</span>
                  </div>
                  {finance && (
                    <p className="text-xs text-muted-foreground">Value: {formatINR(valueByProject.get(r.projectId) ?? null)}</p>
                  )}
                  {r.lotRows.map((l) => (
                    <Link key={l.lotId} href={`/inventory/lots/${l.lotId}`} className="block">
                      <MobileRowCard
                        title={lotCode.get(l.lotId) ?? "—"}
                        fields={[
                          { label: "From PO", value: poByLot.get(l.lotId)?.po_no ?? "—" },
                          { label: "Into build", value: !isZero(l.intoBuild) ? `${formatNumber(l.intoBuild)}${unitSuffix}` : "—" },
                          ...(showJobWork ? [{ label: "At job worker", value: !isZero(l.atJobWorker) ? `${formatNumber(l.atJobWorker)}${unitSuffix}` : "—" }] : []),
                          ...(showReversed ? [{ label: "Reversed", value: !isZero(l.reversed) ? `−${formatNumber(l.reversed)}${unitSuffix}` : "—" }] : []),
                          { label: "Net", value: <span className="font-semibold">{formatNumber(l.net)}{unitSuffix}</span> },
                        ]}
                      />
                    </Link>
                  ))}
                </div>
              ))}
              <p className="px-1 text-sm">
                <span className="text-muted-foreground">Total</span>{" "}
                <span className="font-bold">{formatNumber(consumedQty)}{unitSuffix}</span>
              </p>
            </div>
            {showJobWork && (
              <p className="mt-2 text-xs text-muted-foreground">
                &ldquo;At job worker&rdquo; material has left stock against the project but is with a vendor
                for machining, not yet in the build. It is included in Net.
              </p>
            )}
          </>
        )}
      </section>

      {/* Consumption history — collapsed by default; it is the audit trail, not
          the day-to-day view. CollapsibleSection is a native <details>, so it
          opens without JavaScript. */}
      <CollapsibleSection
        title="Consumption history"
        badge={
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal normal-case text-muted-foreground">
            {allMovements.length}
          </span>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Every issue and reversal, newest first
          {historyRows.length < allMovements.length && ` — showing the latest ${historyRows.length}`}.
        </p>
        {allMovements.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No consumption recorded yet.</p>
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead>Via</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.map((m) => {
                    const isReturn = m.movement_type === "return";
                    return (
                    <TableRow key={m.id}>
                      <TableCell className="text-muted-foreground">{formatDate(m.performed_at)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {m.lot_id ? (
                          <Link href={`/inventory/lots/${m.lot_id}`} className="text-primary hover:underline">
                            {lotCode.get(m.lot_id) ?? "—"}
                          </Link>
                        ) : (lotCode.get(m.lot_id) ?? "—")}
                      </TableCell>
                      <TableCell className={`font-semibold ${isReturn ? "text-green-700" : "text-red-600"}`}>
                        {isReturn ? "+" : "−"}{formatNumber(Math.abs(Number(m.qty)))}{unitSuffix}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.project_id ? projNo.get(m.project_id) ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.performed_by ? (perfName.get(m.performed_by) ?? "—") : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={isReturn ? "outline" : "secondary"}>
                          {isReturn ? "reversal" : m.reference_type ?? "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-3 sm:hidden">
              {historyRows.map((m) => {
                const isReturn = m.movement_type === "return";
                return (
                <MobileRowCard
                  key={m.id}
                  title={
                    m.lot_id ? (
                      <Link href={`/inventory/lots/${m.lot_id}`} className="text-primary hover:underline">
                        {lotCode.get(m.lot_id) ?? "—"}
                      </Link>
                    ) : (lotCode.get(m.lot_id) ?? "—")
                  }
                  subtitle={formatDate(m.performed_at)}
                  badge={<Badge variant={isReturn ? "outline" : "secondary"}>{isReturn ? "reversal" : m.reference_type ?? "—"}</Badge>}
                  fields={[
                    { label: isReturn ? "Qty returned" : "Qty consumed", value: <span className={`font-semibold ${isReturn ? "text-green-700" : "text-red-600"}`}>{isReturn ? "+" : "−"}{formatNumber(Math.abs(Number(m.qty)))}{unitSuffix}</span> },
                    { label: "Project", value: m.project_id ? projNo.get(m.project_id) ?? "—" : "—" },
                    { label: "By", value: m.performed_by ? (perfName.get(m.performed_by) ?? "—") : "—" },
                  ]}
                />
                );
              })}
            </div>
          </>
        )}
      </CollapsibleSection>
    </div>
  );
}

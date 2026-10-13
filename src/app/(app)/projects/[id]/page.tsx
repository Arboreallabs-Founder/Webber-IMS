import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canSeeFinancials, requirePathAccess } from "@/lib/auth";
import { getVendors, getComponentsFull, getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { FileSpreadsheet } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { formatDate, formatINR, projectLabel } from "@/lib/utils";
import { LineItemEditor, type VariantParam } from "./line-item-editor";
import { BomPanel } from "./bom-panel";
import { IssuedPanel } from "./issued-panel";
import { StockStatusPanel, type StockStatusRow } from "./stock-status-panel";
import { JobWorkPanel, type JwStockRow, type JwOrderRow } from "./job-work-panel";
import { ShortfallPanel } from "./shortfall-panel";
import { PhaseBanner } from "./phase-banner";
import { SitePurchaseForm } from "./site-purchase-form";
import { FinishedGoodsForm } from "./finished-goods-form";
import {
  addLineItem,
  removeLineItem,
  generateBom,
  startCustomBom,
  approveBom,
  unapproveBom,
  addManualBomLine,
  removeBomLine,
  updateProjectStatus,
  blockStockForBom,
} from "./actions";
import { logSitePurchase } from "../../site-purchases/actions";
import { logFinishedGoods } from "../../finished-goods/actions";

function variantText(sel: unknown): string {
  if (!sel || typeof sel !== "object") return "";
  return Object.entries(sel as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/projects");
  const { id } = await params;
  const profile = await getProfile();
  const canWrite = canWriteMasters(profile?.role);
  const supabase = await createClient();

  // Wave 1 (parallel): everything that only needs the route `id`, not any
  // other query's result — includes what used to be separate sequential
  // awaits (costing/shortfall/consumption/myJwOrders) purely because they
  // were written after earlier `await`s, not because they depended on them.
  const [
    { data: project },
    { data: products },
    { data: vparams },
    { data: lineItems },
    { data: bom },
    components,
    vendorsAll,
    customersAll,
    { data: costing },
    { data: shortfall },
    { data: consumption },
    { data: myJwOrders },
  ] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("products").select("id, sku_code, model_name").order("sku_code"),
    supabase.from("product_variant_params").select("*").order("sort_order"),
    supabase.from("project_line_items").select("*").eq("project_id", id).order("created_at"),
    supabase.from("boms").select("id, status, approved_at").eq("project_id", id).maybeSingle(),
    getComponentsFull(),
    getVendors(),
    getCustomers(),
    supabase.from("v_project_costing")
      .select("customer_po_value, ordered_value, received_value, consumed_value")
      .eq("project_id", id)
      .maybeSingle(),
    supabase.from("v_project_shortfall")
      .select("component_id, required_qty, ordered_qty, on_hand, consumed_qty, sent_to_jw_qty, shortfall_qty")
      .eq("project_id", id),
    supabase.from("v_project_consumption").select("component_id, consumed_qty").eq("project_id", id),
    supabase.from("job_work_orders")
      .select("id, jw_no, vendor_id, status, sent_date, expected_date")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!project) notFound();
  const vendors = vendorsAll.filter((v) => v.is_active);
  // In-memory lookup against the wave-1 customer list — no query needed.
  const customer = project.customer_id ? customersAll.find((c) => c.id === project.customer_id) ?? null : null;

  const productLabel = new Map((products ?? []).map((p) => [p.id, `${p.sku_code} — ${p.model_name}`]));
  const componentLabel = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));

  let shortfallRows = (shortfall ?? [])
    .map((s) => ({
      component_id: s.component_id ?? "",
      component_label: s.component_id ? componentLabel.get(s.component_id) ?? "—" : "—",
      required: Number(s.required_qty ?? 0),
      ordered: Number(s.ordered_qty ?? 0),
      on_hand: Number(s.on_hand ?? 0),
      consumed: Number(s.consumed_qty ?? 0),
      sent_to_jw: Number(s.sent_to_jw_qty ?? 0),
      shortfall: Number(s.shortfall_qty ?? 0),
    }))
    .sort((a, b) => b.shortfall - a.shortfall);

  const paramsByProduct: Record<string, VariantParam[]> = {};
  for (const p of vparams ?? []) {
    (paramsByProduct[p.product_id] ??= []).push({
      name: p.name,
      input_type: p.input_type,
      options: (p.options as (string | number)[] | null) ?? null,
      min_value: p.min_value,
      max_value: p.max_value,
      uom: p.uom,
    });
  }

  const liRows = (lineItems ?? []).map((li) => ({
    id: li.id,
    product_label: productLabel.get(li.product_id) ?? "—",
    variant_text: variantText(li.variant_selections),
    quantity: li.quantity,
  }));

  // myJwOrders already fetched in wave 1 — derive the ids wave 2 needs.
  const myJwOrderIds = (myJwOrders ?? []).map((o) => o.id);
  const openJwOrderIds = new Set((myJwOrders ?? []).filter((o) => o.status === "sent" || o.status === "partial").map((o) => o.id));

  // Wave 2 (parallel, needs wave 1's bom.id / myJwOrderIds) — these two
  // queries don't depend on each other, only on wave 1's results.
  const [{ data: rawBomLines }, { data: myJwLines }] = await Promise.all([
    bom
      ? supabase.from("bom_lines").select("id, component_id, required_qty, source, note").eq("bom_id", bom.id).order("source")
      : Promise.resolve({ data: null }),
    myJwOrderIds.length
      ? supabase.from("job_work_lines").select("jw_order_id, component_id, qty_sent, qty_returned").in("jw_order_id", myJwOrderIds)
      : Promise.resolve({ data: [] }),
  ]);

  let bomLines: { id: string; component_id: string | null; component_label: string; required_qty: number; source: string; note: string | null }[] = [];
  const plannedByComponent = new Map<string, number>();
  if (bom && rawBomLines) {
    bomLines = rawBomLines.map((l) => ({
      id: l.id,
      component_id: l.component_id,
      component_label: l.component_id ? componentLabel.get(l.component_id) ?? "—" : "—",
      required_qty: l.required_qty,
      source: l.source,
      note: l.note,
    }));
    for (const l of rawBomLines) {
      if (!l.component_id) continue;
      plannedByComponent.set(l.component_id, (plannedByComponent.get(l.component_id) ?? 0) + Number(l.required_qty ?? 0));
    }
  }

  const sentOutstanding = new Map<string, number>();
  for (const l of myJwLines ?? []) {
    if (!l.component_id || !openJwOrderIds.has(l.jw_order_id)) continue;
    const out = Number(l.qty_sent ?? 0) - Number(l.qty_returned ?? 0);
    sentOutstanding.set(l.component_id, (sentOutstanding.get(l.component_id) ?? 0) + out);
  }

  // Materials issued: actual consumption (from wave 1's v_project_consumption) vs the
  // planned BOM — surfaces anything scanned/issued that isn't even in the plan.
  const issuedByComponent = new Map<string, number>();
  for (const c of consumption ?? []) {
    if (!c.component_id) continue;
    issuedByComponent.set(c.component_id, Number(c.consumed_qty ?? 0));
  }
  const issuedComponentIds = new Set([...plannedByComponent.keys(), ...issuedByComponent.keys()]);
  const issuedRows = [...issuedComponentIds]
    .map((cid) => ({
      component_id: cid,
      component_label: componentLabel.get(cid) ?? "—",
      planned: plannedByComponent.get(cid) ?? 0,
      issued: issuedByComponent.get(cid) ?? 0,
      in_plan: plannedByComponent.has(cid),
    }))
    .sort((a, b) => (a.in_plan === b.in_plan ? a.component_label.localeCompare(b.component_label) : a.in_plan ? 1 : -1));

  const plannedComponentIds = [...plannedByComponent.keys()];

  // Wave 3 (parallel, needs wave 2's plannedComponentIds). Job-work component
  // ids — needed before Stock status below, so JW components (which have
  // their own dedicated, stage-aware panel) can be excluded from that table
  // instead of showing a misleading "Available"/"Blocked" badge for stock
  // that's still raw and can't actually be consumed — and stock-status lots.
  const [{ data: jwComps }, { data: statusLots }] = await Promise.all([
    plannedComponentIds.length
      ? supabase.from("components").select("id, jw_vendor_id").in("id", plannedComponentIds).eq("is_job_work", true)
      : Promise.resolve({ data: [] }),
    plannedComponentIds.length
      ? supabase
          .from("inventory_lots")
          .select("component_id, qty_on_hand, status, project_id, jw_stage")
          .in("component_id", plannedComponentIds)
          .neq("status", "consumed")
          .gt("qty_on_hand", 0)
      : Promise.resolve({ data: [] }),
  ]);
  const jwComponentIds = new Set((jwComps ?? []).map((c) => c.id));

  const otherProjectIds = [...new Set((statusLots ?? [])
    .filter((l) => l.project_id && l.project_id !== id)
    .map((l) => l.project_id as string))];
  // Wave 4 (needs wave 3's otherProjectIds). otherCustomers is no longer its
  // own query — reuses wave 1's full customer list.
  const { data: otherProjects } = otherProjectIds.length
    ? await supabase.from("projects").select("id, project_no, customer_id").in("id", otherProjectIds)
    : { data: [] };
  const otherCustName = new Map((customersAll ?? []).map((c) => [c.id, c.name]));
  const otherProjectNo = new Map((otherProjects ?? []).map((p) => [
    p.id,
    projectLabel({ project_no: p.project_no, customer_name: p.customer_id ? otherCustName.get(p.customer_id) ?? null : null }),
  ]));

  const stockStatusRows: StockStatusRow[] = plannedComponentIds
    .filter((cid) => !jwComponentIds.has(cid))
    .map((cid) => {
      const required = plannedByComponent.get(cid) ?? 0;
      const lots = (statusLots ?? []).filter((l) => l.component_id === cid);
      const blockedMine = lots
        .filter((l) => l.status === "issued" && l.project_id === id)
        .reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
      const openAvailable = lots
        .filter((l) => l.status === "open" && (l.project_id === null || l.project_id === id))
        .reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
      const elsewhereMap = new Map<string, number>();
      for (const l of lots) {
        if (l.status === "issued" && l.project_id && l.project_id !== id) {
          const label = otherProjectNo.get(l.project_id) ?? "—";
          elsewhereMap.set(label, (elsewhereMap.get(label) ?? 0) + Number(l.qty_on_hand ?? 0));
        }
      }
      const elsewhere = [...elsewhereMap.entries()].map(([project_no, qty]) => ({ project_no, qty }));

      // Material already consumed on this project has left stock — its lots read
      // zero on hand — but it was used for exactly this demand, so it counts as
      // covered rather than missing. Without this the panel called a fully-built
      // project "Out of stock" on every line: 10 of them on 45005117511 alone,
      // each consumed to the exact required quantity.
      //
      // project_shortfall() already nets consumption off demand this way
      // (migration 0031, written against the same complaint), so the panel is
      // brought in line with the shortfall table directly below it rather than
      // inventing a second rule.
      const consumedMine = issuedByComponent.get(cid) ?? 0;
      const outstanding = Math.max(required - consumedMine, 0);

      let status: StockStatusRow["status"];
      if (outstanding <= 0) status = "in_wip";
      else if (blockedMine >= outstanding) status = "blocked";
      else if (blockedMine + openAvailable >= outstanding) status = "available";
      else if (elsewhere.length > 0) status = "issued_elsewhere";
      else status = "out_of_stock";

      return {
        component_id: cid,
        component_label: componentLabel.get(cid) ?? "—",
        required,
        consumed_mine: consumedMine,
        blocked_mine: blockedMine,
        open_available: openAvailable,
        elsewhere,
        status,
      };
    })
    .sort((a, b) => a.component_label.localeCompare(b.component_label));

  // True when every planned component is job-work (Stock status ends up empty
  // not because there's no BOM, but because they all belong in Job work below).
  const allJobWork = plannedComponentIds.length > 0 && stockStatusRows.length === 0 && jwComponentIds.size === plannedComponentIds.length;

  // Job-work vendor breakdown — myJwOrders/myJwLines/sentOutstanding were
  // already computed above (wave 1 / wave 2).
  const jwVendorIds = [...new Set((jwComps ?? []).map((c) => c.jw_vendor_id).filter(Boolean))] as string[];
  const jwOrderVendorIds = [...new Set((myJwOrders ?? []).map((o) => o.vendor_id).filter(Boolean))] as string[];
  const jwVendorIdSet = new Set([...jwVendorIds, ...jwOrderVendorIds]);
  const jwVendors = vendorsAll.filter((v) => jwVendorIdSet.has(v.id));
  const jwVendorName = new Map((jwVendors ?? []).map((v) => [v.id, v.name]));

  const jwStockRows: JwStockRow[] = [...jwComponentIds]
    .map((cid) => {
      const required = plannedByComponent.get(cid) ?? 0;
      const lots = (statusLots ?? []).filter((l) => l.component_id === cid && (!l.project_id || l.project_id === id));
      const rawAvailable = lots.filter((l) => l.jw_stage === "raw").reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
      const completedAvailable = lots.filter((l) => l.jw_stage === "completed").reduce((s, l) => s + Number(l.qty_on_hand ?? 0), 0);
      const sent = sentOutstanding.get(cid) ?? 0;

      let status: JwStockRow["status"];
      if (completedAvailable >= required) status = "ready";
      else if (sent > 0) status = "awaiting_return";
      else if (rawAvailable > 0) status = "needs_job_work";
      else status = "no_stock";

      return {
        component_id: cid,
        component_label: componentLabel.get(cid) ?? "—",
        required,
        raw_available: rawAvailable,
        sent_outstanding: sent,
        completed_available: completedAvailable,
        status,
      };
    })
    .sort((a, b) => a.component_label.localeCompare(b.component_label));

  const jwOrderRows: JwOrderRow[] = (myJwOrders ?? []).map((o) => ({
    id: o.id,
    jw_no: o.jw_no,
    vendor_name: o.vendor_id ? jwVendorName.get(o.vendor_id) ?? null : null,
    status: o.status,
    sent_date: o.sent_date,
    expected_date: o.expected_date,
  }));

  // Components whose covering stock right now is raw or in-transit-to-vendor,
  // not completed — labeled "Name (raw)" in the BOM and shortfall panels.
  const rawOnlyComponentIds = new Set(
    jwStockRows
      .filter((r) => r.completed_available <= 0 && (r.raw_available > 0 || r.sent_outstanding > 0))
      .map((r) => r.component_id)
  );
  const withRaw = (cid: string | null, label: string) => (cid && rawOnlyComponentIds.has(cid) ? `${label} (raw)` : label);
  bomLines = bomLines.map((l) => ({ ...l, component_label: withRaw(l.component_id, l.component_label) }));
  shortfallRows = shortfallRows.map((r) => ({ ...r, component_label: withRaw(r.component_id, r.component_label) }));

  return (
    <div>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All projects
      </Link>
      <PageHeader
        title={project.project_no}
        description={customer?.name ?? undefined}
        action={
          <div className="flex items-center gap-3">
            <Link href={`/projects/${id}/reports`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <FileSpreadsheet className="size-4" /> Reports
            </Link>
            <Badge variant="secondary">{project.status}</Badge>
          </div>
        }
      />

      <PhaseBanner
        projectId={id}
        status={project.status}
        lineItemCount={liRows.length}
        bom={bom ?? null}
        hasShortfall={shortfallRows.some((r) => r.shortfall > 0)}
        canWrite={canWrite}
      />

      <Card className="mb-8">
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <Info label="Order date" value={formatDate(project.order_date)} />
          <Info label="Delivery date" value={formatDate(project.delivery_date)} />
          <Info label="Customer PO" value={project.customer_po_number || "—"} />
          {canSeeFinancials(profile?.role) && (
            <Info label="Budgeted Company Cost" value={formatINR(project.customer_po_value)} />
          )}
        </CardContent>
      </Card>

      {canSeeFinancials(profile?.role) && costing && (
        <Card className="mb-8">
          <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-5">
            <Info label="Budgeted Company Cost" value={formatINR(costing.customer_po_value)} />
            <Info label="Ordered" value={formatINR(costing.ordered_value)} />
            <Info label="Received" value={formatINR(costing.received_value)} />
            <Info label="WIP" value={formatINR(costing.consumed_value)} />
            <Info label="Not yet in WIP" value={formatINR(Math.max(Number(costing.received_value ?? 0) - Number(costing.consumed_value ?? 0), 0))} />
          </CardContent>
        </Card>
      )}

      <CollapsibleSection id="line-items" title="Line items (model + variant)" defaultOpen>
        <LineItemEditor
          projectId={id}
          products={products ?? []}
          paramsByProduct={paramsByProduct}
          lineItems={liRows}
          canWrite={canWrite}
          addAction={addLineItem}
          removeAction={removeLineItem}
        />
      </CollapsibleSection>

      <CollapsibleSection id="bom" title="Bill of Materials" defaultOpen>
        <BomPanel
          projectId={id}
          bom={bom ?? null}
          lines={bomLines}
          components={components ?? []}
          canWrite={canWrite}
          generateAction={generateBom}
          startCustomAction={startCustomBom}
          approveAction={approveBom}
          unapproveAction={unapproveBom}
          addManualAction={addManualBomLine}
          removeLineAction={removeBomLine}
        />
      </CollapsibleSection>

      {jwStockRows.length > 0 && (
        <CollapsibleSection
          id="job-work"
          title="Job work"
          defaultOpen={jwStockRows.some((r) => r.status === "needs_job_work")}
        >
          <JobWorkPanel projectId={id} rows={jwStockRows} orders={jwOrderRows} canWrite={canWrite} />
        </CollapsibleSection>
      )}

      <CollapsibleSection id="stock-status" title="Stock status & blocking" defaultOpen>
        <StockStatusPanel
          projectId={id}
          bomId={bom?.id ?? null}
          bomApproved={bom?.status === "approved"}
          rows={stockStatusRows}
          allJobWork={allJobWork}
          canWrite={canWrite}
          blockAction={blockStockForBom}
        />
      </CollapsibleSection>

      <CollapsibleSection id="issued" title="Materials issued">
        <IssuedPanel rows={issuedRows} />
      </CollapsibleSection>

      <CollapsibleSection id="shortfall" title="Stock check & shortfall" defaultOpen={shortfallRows.some((r) => r.shortfall > 0)}>
        <ShortfallPanel projectId={id} rows={shortfallRows} canProcure={canWrite} />
      </CollapsibleSection>

      <CollapsibleSection id="site-purchase" title="Site purchase">
        <SitePurchaseForm
          projectId={id}
          bomApproved={bom?.status === "approved"}
          components={components ?? []}
          vendors={vendors ?? []}
          showUnitCost={canSeeFinancials(profile?.role)}
          action={logSitePurchase}
        />
      </CollapsibleSection>

      {canWrite && (
        <CollapsibleSection id="finished-goods" title="Finished goods">
          <FinishedGoodsForm
            projectId={id}
            bomApproved={bom?.status === "approved"}
            hasConsumption={Number(costing?.consumed_value ?? 0) > 0}
            lineItems={liRows}
            products={(products ?? []).map((p) => ({ id: p.id, label: `${p.sku_code} — ${p.model_name}` }))}
            action={logFinishedGoods}
          />
        </CollapsibleSection>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}

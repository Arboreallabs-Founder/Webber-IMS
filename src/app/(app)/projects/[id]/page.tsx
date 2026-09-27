import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canSeeFinancials } from "@/lib/auth";
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
import { ShortfallPanel } from "./shortfall-panel";
import { PhaseBanner } from "./phase-banner";
import { SitePurchaseForm } from "./site-purchase-form";
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

function variantText(sel: unknown): string {
  if (!sel || typeof sel !== "object") return "";
  return Object.entries(sel as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
      shortfall: Number(s.shortfall_qty ?? 0),
    }))
    .sort((a, b) => b.shortfall - a.shortfall);

  // "Available as alternative" — for each short component, check whether any
  // of its approved alternatives currently has free stock. "Free" mirrors
  // project_shortfall()'s own on-hand definition: general/untagged lots plus
  // this project's own, excluding stock already reserved to a different one.
  const shortComponentIds = shortfallRows.filter((r) => r.shortfall > 0).map((r) => r.component_id).filter(Boolean);
  const { data: altLinks } = shortComponentIds.length
    ? await supabase.from("component_alternatives").select("component_id, alternative_id").in("component_id", shortComponentIds)
    : { data: [] };
  const altIdsByComponent = new Map<string, string[]>();
  for (const a of altLinks ?? []) {
    (altIdsByComponent.get(a.component_id) ?? altIdsByComponent.set(a.component_id, []).get(a.component_id)!).push(a.alternative_id);
  }
  const allAltIds = [...new Set((altLinks ?? []).map((a) => a.alternative_id))];
  const { data: altLots } = allAltIds.length
    ? await supabase
        .from("inventory_lots")
        .select("component_id, qty_on_hand, project_id")
        .in("component_id", allAltIds)
        .neq("status", "consumed")
        .gt("qty_on_hand", 0)
    : { data: [] };
  const onHandByAlt = new Map<string, number>();
  for (const l of altLots ?? []) {
    if (l.project_id && l.project_id !== id) continue; // reserved to a different project — not free
    onHandByAlt.set(l.component_id, (onHandByAlt.get(l.component_id) ?? 0) + Number(l.qty_on_hand ?? 0));
  }
  shortfallRows = shortfallRows.map((r) => {
    if (r.shortfall <= 0) return r;
    const alternatives = (altIdsByComponent.get(r.component_id) ?? [])
      .map((altId) => ({ component_id: altId, label: componentLabel.get(altId) ?? "—", on_hand: onHandByAlt.get(altId) ?? 0 }))
      .filter((a) => a.on_hand > 0)
      .sort((a, b) => b.on_hand - a.on_hand);
    return alternatives.length > 0 ? { ...r, alternatives } : r;
  });

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

  const { data: rawBomLines } = bom
    ? await supabase.from("bom_lines").select("id, component_id, required_qty, source, note").eq("bom_id", bom.id).order("source")
    : { data: null };

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

  // Wave 3 (parallel, needs wave 2's plannedComponentIds) — stock-status lots.
  const { data: statusLots } = plannedComponentIds.length
    ? await supabase
        .from("inventory_lots")
        .select("component_id, qty_on_hand, status, project_id")
        .in("component_id", plannedComponentIds)
        .neq("status", "consumed")
        .gt("qty_on_hand", 0)
    : { data: [] };

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

      let status: StockStatusRow["status"];
      if (blockedMine >= required) status = "blocked";
      else if (blockedMine + openAvailable >= required) status = "available";
      else if (elsewhere.length > 0) status = "issued_elsewhere";
      else status = "out_of_stock";

      return {
        component_id: cid,
        component_label: componentLabel.get(cid) ?? "—",
        required,
        blocked_mine: blockedMine,
        open_available: openAvailable,
        elsewhere,
        status,
      };
    })
    .sort((a, b) => a.component_label.localeCompare(b.component_label));

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

      <CollapsibleSection id="stock-status" title="Stock status & blocking" defaultOpen>
        <StockStatusPanel
          projectId={id}
          bomId={bom?.id ?? null}
          bomApproved={bom?.status === "approved"}
          rows={stockStatusRows}
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

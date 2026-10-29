import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TemplateLineEditor, type Line, type PreviewLine } from "./template-line-editor";
import { upsertTemplateLine, removeTemplateLine } from "../actions";
import { createComponentQuick, promoteAssemblyLine } from "../../bom-builder/actions";
import { readAll } from "@/lib/server/read-all";

export default async function BomTemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/masters");
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: template } = await supabase.from("bom_templates").select("*").eq("id", id).single();
  if (!template) notFound();

  const [{ data: lines }, components, { data: product }, { data: ownerComp }] = await Promise.all([
    supabase.from("bom_template_lines").select("*").eq("bom_template_id", id).order("sort_order", { nullsFirst: false }),
    readAll((f, t) => supabase.from("components").select("id, component_no, name").order("component_no").order("id").range(f, t)),
    template.product_id ? supabase.from("products").select("sku_code, model_name").eq("id", template.product_id).maybeSingle() : Promise.resolve({ data: null }),
    template.component_id ? supabase.from("components").select("component_no, name").eq("id", template.component_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  // variant params: product template → its own; sub-assembly → union across products (deduped by name)
  const { data: vparams } = template.product_id
    ? await supabase.from("product_variant_params").select("name, input_type, options").eq("product_id", template.product_id).order("sort_order")
    : await supabase.from("product_variant_params").select("name, input_type, options").order("sort_order");

  const compById = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const lineLabel = (l: {
    component_id: string | null;
    line_type: string | null;
    assembly_name?: string | null;
    section?: string | null;
  }) =>
    l.component_id
      ? compById.get(l.component_id) ?? "—"
      : l.line_type === "assembly"
        ? l.assembly_name || l.section || "Sub-assembly"
        : "(variant-driven)";

  // Gather sub-assembly templates + their lines (recursively) so sub-BOM parts
  // can expand inline as a dropdown under each sub-assembly line.
  const subTemplateByComponent: Record<string, string> = {};
  const subLinesByTemplate: Record<string, PreviewLine[]> = {};
  const assemblyCompIds = (ls: { line_type: string | null; component_id: string | null }[]) =>
    [...new Set(ls.filter((l) => l.line_type === "assembly" && l.component_id).map((l) => l.component_id as string))];

  let frontier = assemblyCompIds(lines ?? []);
  const seenTemplates = new Set<string>();
  while (frontier.length) {
    const { data: sts } = await supabase.from("bom_templates").select("id, component_id").in("component_id", frontier).eq("is_active", true);
    const freshTemplateIds: string[] = [];
    for (const st of sts ?? []) {
      if (st.component_id) subTemplateByComponent[st.component_id] = st.id;
      if (!seenTemplates.has(st.id)) { seenTemplates.add(st.id); freshTemplateIds.push(st.id); }
    }
    if (!freshTemplateIds.length) break;
    const { data: stLines } = await supabase.from("bom_template_lines").select("*").in("bom_template_id", freshTemplateIds).order("sort_order", { nullsFirst: false });
    const next = new Set<string>();
    for (const l of stLines ?? []) {
      (subLinesByTemplate[l.bom_template_id as string] ??= []).push({
        id: l.id, component_id: l.component_id,
        component_label: lineLabel(l),
        quantity: l.quantity, is_variant_driven: l.is_variant_driven, line_type: l.line_type ?? null, variant_rule: l.variant_rule,
      });
      if (l.line_type === "assembly" && l.component_id) next.add(l.component_id as string);
    }
    frontier = [...next];
  }

  const rows: Line[] = (lines ?? []).map((l) => ({
    id: l.id,
    component_id: l.component_id,
    component_label: lineLabel(l),
    quantity: l.quantity,
    is_variant_driven: l.is_variant_driven,
    variant_rule: l.variant_rule,
    note: l.note,
    parent_line_id: l.parent_line_id ?? null,
    line_type: l.line_type ?? null,
    section: l.section ?? null,
    assembly_name: l.assembly_name ?? null,
  }));

  const seenParam = new Set<string>();
  const dropdownParams = (vparams ?? [])
    .filter((p) => p.input_type === "dropdown" && Array.isArray(p.options) && !seenParam.has(p.name) && !!seenParam.add(p.name))
    .map((p) => ({ name: p.name, options: p.options as (string | number)[] }));

  const isSub = !!template.component_id;
  const ownerLabel = product
    ? `${product.sku_code} — ${product.model_name}`
    : ownerComp
      ? `${ownerComp.component_no} — ${ownerComp.name}`
      : "BOM Template";

  const commonCount = rows.filter((r) => !r.is_variant_driven).length;
  const variantCount = rows.filter((r) => r.is_variant_driven).length;
  const assemblyCount = rows.filter((r) => r.line_type === "assembly").length;

  return (
    <div>
      <Link href="/masters/bom-templates" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All templates
      </Link>
      <PageHeader
        title={ownerLabel}
        description={`${isSub ? "Sub-assembly BOM · " : ""}Version ${template.version}${template.is_active ? " (active)" : ""}`}
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-6 p-5 text-sm">
          <Stat label="Total lines" value={rows.length} />
          <Stat label="Sub-assemblies" value={assemblyCount} />
          <Stat label="Common" value={commonCount} />
          <Stat label="Variant-driven" value={variantCount} />
          <div className="ml-auto">
            {template.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">BOM template is empty</p>
            <p className="mt-0.5 text-amber-700">
              No lines have been added yet. Use the editor below to add common and variant-driven components for this product.
            </p>
          </div>
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Template lines</h2>
      <TemplateLineEditor
        templateId={id}
        lines={rows}
        components={components ?? []}
        dropdownParams={dropdownParams}
        subTemplateByComponent={subTemplateByComponent}
        subLinesByTemplate={subLinesByTemplate}
        canWrite={canWriteMasters(profile?.role)}
        upsertAction={upsertTemplateLine}
        removeAction={removeTemplateLine}
        createComponentAction={createComponentQuick}
        promoteAction={promoteAssemblyLine}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

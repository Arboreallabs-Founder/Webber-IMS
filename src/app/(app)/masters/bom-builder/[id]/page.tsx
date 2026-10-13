import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { getCategories } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { TemplateLineEditor, type Line, type PreviewLine } from "../../bom-templates/[id]/template-line-editor";
import { VariantParamEditor } from "../../products/[id]/variant-param-editor";
import {
  upsertTemplateLine,
  removeTemplateLine,
  upsertVariantParam,
  removeVariantParam,
  createComponentQuick,
  promoteAssemblyLine,
} from "../actions";
import { BuilderProductHeader } from "./product-header";
import { BuilderChecklist } from "./checklist";

type LineRow = {
  id: string;
  component_id: string | null;
  line_type: string | null;
  assembly_name: string | null;
  section: string | null;
  quantity: number;
  is_variant_driven: boolean;
  variant_rule: Line["variant_rule"];
  note: string | null;
  parent_line_id: string | null;
};

/** Walk sub-assembly templates (component-owned) recursively for inline preview. */
async function loadSubTree(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownLines: { line_type: string | null; component_id: string | null }[],
  lineLabel: (l: LineRow) => string,
) {
  const subTemplateByComponent: Record<string, string> = {};
  const subLinesByTemplate: Record<string, PreviewLine[]> = {};
  const assemblyCompIds = (ls: { line_type: string | null; component_id: string | null }[]) =>
    [...new Set(ls.filter((l) => l.line_type === "assembly" && l.component_id).map((l) => l.component_id as string))];

  let frontier = assemblyCompIds(ownLines);
  const seenTemplates = new Set<string>();
  while (frontier.length) {
    const { data: sts } = await supabase
      .from("bom_templates")
      .select("id, component_id")
      .in("component_id", frontier)
      .eq("is_active", true);
    const fresh: string[] = [];
    for (const st of sts ?? []) {
      if (st.component_id) subTemplateByComponent[st.component_id] = st.id;
      if (!seenTemplates.has(st.id)) {
        seenTemplates.add(st.id);
        fresh.push(st.id);
      }
    }
    if (!fresh.length) break;
    const { data: stLines } = await supabase
      .from("bom_template_lines")
      .select("*")
      .in("bom_template_id", fresh)
      .order("sort_order", { nullsFirst: false });
    const next = new Set<string>();
    for (const l of stLines ?? []) {
      (subLinesByTemplate[l.bom_template_id as string] ??= []).push({
        id: l.id,
        component_id: l.component_id,
        component_label: lineLabel(l as LineRow),
        quantity: l.quantity,
        is_variant_driven: l.is_variant_driven,
        line_type: l.line_type ?? null,
        variant_rule: l.variant_rule,
      });
      if (l.line_type === "assembly" && l.component_id) next.add(l.component_id as string);
    }
    frontier = [...next];
  }
  return { subTemplateByComponent, subLinesByTemplate };
}

export default async function BomBuilderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/masters");
  const { id } = await params;
  const profile = await getProfile();
  const canWrite = canWriteMasters(profile?.role);
  const supabase = await createClient();

  const { data: template } = await supabase.from("bom_templates").select("*").eq("id", id).single();
  if (!template) notFound();

  const [{ data: lines }, { data: components }] = await Promise.all([
    supabase.from("bom_template_lines").select("*").eq("bom_template_id", id).order("sort_order", { nullsFirst: false }),
    supabase.from("components").select("id, component_no, name").order("component_no"),
  ]);

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

  const { subTemplateByComponent, subLinesByTemplate } = await loadSubTree(
    supabase,
    lines ?? [],
    lineLabel as (l: LineRow) => string,
  );

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

  const lineEditor = (dropdownParams: { name: string; options: (string | number)[] }[]) => (
    <TemplateLineEditor
      templateId={id}
      lines={rows}
      components={components ?? []}
      dropdownParams={dropdownParams}
      subTemplateByComponent={subTemplateByComponent}
      subLinesByTemplate={subLinesByTemplate}
      canWrite={canWrite}
      upsertAction={upsertTemplateLine}
      removeAction={removeTemplateLine}
      createComponentAction={createComponentQuick}
      promoteAction={promoteAssemblyLine}
    />
  );

  // ---- sub-assembly (component-owned) template: just the line editor ----
  if (!template.product_id) {
    const { data: ownerComp } = await supabase
      .from("components")
      .select("component_no, name")
      .eq("id", template.component_id)
      .maybeSingle();
    return (
      <div>
        <Link
          href="/masters/bom-builder"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All BOMs
        </Link>
        <PageHeader
          title={ownerComp ? `${ownerComp.component_no} — ${ownerComp.name}` : "Sub-assembly BOM"}
          description={`Sub-assembly BOM · Version ${template.version}${template.is_active ? " (active)" : ""}`}
        />
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">BOM lines</h2>
        {lineEditor([])}
      </div>
    );
  }

  // ---- product template: full builder ----
  const [{ data: product }, categories, { data: vparams }] = await Promise.all([
    supabase.from("products").select("id, sku_code, model_name, category_id, is_serialized, description").eq("id", template.product_id).maybeSingle(),
    getCategories(),
    supabase.from("product_variant_params").select("*").eq("product_id", template.product_id).order("sort_order"),
  ]);

  const seenParam = new Set<string>();
  const dropdownParams = (vparams ?? [])
    .filter((p) => p.input_type === "dropdown" && Array.isArray(p.options) && !seenParam.has(p.name) && !!seenParam.add(p.name))
    .map((p) => ({ name: p.name, options: p.options as (string | number)[] }));

  return (
    <div>
      <Link
        href="/masters/bom-builder"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All BOMs
      </Link>
      <PageHeader
        title={product ? `${product.sku_code} — ${product.model_name}` : "BOM Builder"}
        description={`Version ${template.version}${template.is_active ? " (active)" : ""}`}
      />

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Product</h2>
          <BuilderProductHeader
            product={
              product ?? {
                id: template.product_id,
                sku_code: "",
                model_name: "",
                category_id: null,
                is_serialized: false,
                description: null,
              }
            }
            categories={categories ?? []}
            canWrite={canWrite}
          />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Variant parameters</h2>
          <VariantParamEditor
            productId={template.product_id}
            params={vparams ?? []}
            canWrite={canWrite}
            upsertAction={upsertVariantParam}
            removeAction={removeVariantParam}
          />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">BOM lines</h2>
          {lineEditor(dropdownParams)}
        </section>

        <BuilderChecklist
          hasCategory={!!product?.category_id}
          lines={rows}
          subLinesByTemplate={subLinesByTemplate}
          subTemplateByComponent={subTemplateByComponent}
        />
      </div>
    </div>
  );
}

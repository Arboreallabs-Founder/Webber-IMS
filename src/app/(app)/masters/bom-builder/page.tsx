import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { getCategories } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { StartBomForm } from "./start-bom-form";
import { BomList, type BomRow } from "./bom-list";
import { CategoryManager, type CategoryRow } from "./category-manager";

export default async function BomBuilderPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const canWrite = canWriteMasters(profile?.role);
  const supabase = await createClient();

  const [{ data: templates }, { data: products }, categories, { data: lines }] = await Promise.all([
    supabase
      .from("bom_templates")
      .select("id, product_id, version, is_active, created_at")
      .not("product_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase.from("products").select("id, sku_code, model_name, category_id"),
    getCategories(),
    supabase.from("bom_template_lines").select("bom_template_id"),
  ]);

  const prodById = new Map((products ?? []).map((p) => [p.id, p]));
  const catNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const lineCounts = new Map<string, number>();
  for (const l of lines ?? []) lineCounts.set(l.bom_template_id, (lineCounts.get(l.bom_template_id) ?? 0) + 1);

  const bomRows: BomRow[] = (templates ?? []).map((t) => {
    const p = t.product_id ? prodById.get(t.product_id) : undefined;
    return {
      id: t.id,
      label: p ? `${p.sku_code} — ${p.model_name}` : "—",
      sku_code: p?.sku_code ?? "",
      model_name: p?.model_name ?? "",
      version: t.version,
      is_active: t.is_active,
      line_count: lineCounts.get(t.id) ?? 0,
    };
  });

  const productsPerCategory = new Map<string, number>();
  for (const p of products ?? []) {
    if (p.category_id) productsPerCategory.set(p.category_id, (productsPerCategory.get(p.category_id) ?? 0) + 1);
  }
  const categoryRows: CategoryRow[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    parent_id: c.parent_id ?? null,
    parent_name: c.parent_id ? catNameById.get(c.parent_id) ?? "—" : null,
    products_using: productsPerCategory.get(c.id) ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title="BOM Builder"
        description="Create, edit, duplicate, and delete product BOMs — with variants, categories, and sub-assemblies — from one screen."
      />

      {canWrite && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Start a new BOM</h2>
          <StartBomForm categories={categories ?? []} />
        </div>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Product BOMs</h2>
      <BomList rows={bomRows} canWrite={canWrite} />

      <CollapsibleSection title="Categories" badge={<span className="text-xs text-muted-foreground">({categoryRows.length})</span>}>
        <CategoryManager rows={categoryRows} canWrite={canWrite} />
      </CollapsibleSection>
    </div>
  );
}

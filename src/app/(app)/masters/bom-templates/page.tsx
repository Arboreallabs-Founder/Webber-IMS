import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function BomTemplatesPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const supabase = await createClient();
  const [{ data: templates }, { data: products }, { data: assemblies }, { data: lines }] = await Promise.all([
    supabase.from("bom_templates").select("*").order("created_at", { ascending: false }),
    supabase.from("products").select("id, sku_code, model_name").order("sku_code"),
    supabase.from("components").select("id, component_no, name").eq("is_assembly", true).order("component_no"),
    supabase.from("bom_template_lines").select("bom_template_id"),
  ]);

  const prodById = new Map((products ?? []).map((p) => [p.id, `${p.sku_code} — ${p.model_name}`]));
  const asmById = new Map((assemblies ?? []).map((a) => [a.id, `${a.component_no} — ${a.name}`]));
  const lineCounts = new Map<string, number>();
  for (const l of lines ?? []) lineCounts.set(l.bom_template_id, (lineCounts.get(l.bom_template_id) ?? 0) + 1);

  const rows = (templates ?? []).map((t) => ({
    ...t,
    owner_label: t.product_id ? (prodById.get(t.product_id) ?? "—") : (asmById.get(t.component_id) ?? "—"),
    owner_type: t.product_id ? "Product" : "Sub-assembly",
    line_count: lineCounts.get(t.id) ?? 0,
  }));

  const columns: Column[] = [
    { key: "owner_label", label: "For" },
    { key: "owner_type", label: "Type", format: "badge" },
    { key: "version", label: "Version", format: "number" },
    { key: "is_active", label: "Active", format: "bool" },
    { key: "line_count", label: "Lines", format: "number" },
  ];
  const fields: Field[] = [
    {
      name: "product_id",
      label: "Product",
      type: "combobox",
      options: (products ?? []).map((p) => ({ value: p.id, label: `${p.sku_code} — ${p.model_name}` })),
      help: "Pick a product OR a sub-assembly below (one, not both).",
    },
    {
      name: "component_id",
      label: "Sub-assembly",
      type: "combobox",
      options: (assemblies ?? []).map((a) => ({ value: a.id, label: `${a.component_no} — ${a.name}` })),
    },
    { name: "version", label: "Version", type: "number", placeholder: "1" },
    { name: "is_active", label: "Active (one active per owner)", type: "checkbox", defaultChecked: true },
  ];

  return (
    <div>
      <PageHeader
        title="BOM Templates"
        description="Per-product bill of materials. Open a template to add lines — mark shared lines “common (yellow)” and configure variant-driven lines."
      />
      <CrudManager
        title="BOM Templates"
        entityName="template"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials
        searchKeys={["owner_label"]}
        detailBase="/masters/bom-templates"
      />
    </div>
  );
}

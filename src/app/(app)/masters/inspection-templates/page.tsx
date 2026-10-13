import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function InspectionTemplatesPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const supabase = await createClient();
  const [{ data: templates }, { data: fields }, { data: components }] = await Promise.all([
    supabase.from("inspection_templates").select("*").order("created_at", { ascending: false }),
    supabase.from("inspection_template_fields").select("template_id").eq("is_active", true),
    supabase.from("components").select("id, inspection_template_id"),
  ]);

  const fieldCounts = new Map<string, number>();
  for (const f of fields ?? []) fieldCounts.set(f.template_id, (fieldCounts.get(f.template_id) ?? 0) + 1);
  const componentCounts = new Map<string, number>();
  for (const c of components ?? []) {
    if (!c.inspection_template_id) continue;
    componentCounts.set(c.inspection_template_id, (componentCounts.get(c.inspection_template_id) ?? 0) + 1);
  }

  const rows = (templates ?? []).map((t) => ({
    ...t,
    field_count: fieldCounts.get(t.id) ?? 0,
    component_count: componentCounts.get(t.id) ?? 0,
  }));

  const columns: Column[] = [
    { key: "name", label: "Template" },
    { key: "field_count", label: "Fields", format: "number" },
    { key: "component_count", label: "Components using it", format: "number" },
    { key: "is_active", label: "Active", format: "bool" },
  ];
  const fieldDefs: Field[] = [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "description", label: "Description", type: "textarea" },
    { name: "is_active", label: "Active", type: "checkbox", defaultChecked: true },
  ];

  return (
    <div>
      <PageHeader
        title="Inspection Templates"
        description="Reusable QC checklists — attach one to a component (Masters → Components) to require an IRN before its goods received at GRN become stock."
      />
      <CrudManager
        title="Inspection Templates"
        entityName="template"
        rows={rows}
        columns={columns}
        fields={fieldDefs}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials
        searchKeys={["name"]}
        detailBase="/masters/inspection-templates"
      />
    </div>
  );
}

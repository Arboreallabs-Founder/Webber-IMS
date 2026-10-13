import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { getCategories } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function CategoriesPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const supabase = await createClient();
  const data = await getCategories();
  const categories = data ?? [];

  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const rows = categories.map((c) => ({
    ...c,
    parent_name: c.parent_id ? nameById.get(c.parent_id) ?? "—" : null,
  }));

  const columns: Column[] = [
    { key: "name", label: "Name" },
    { key: "parent_name", label: "Parent" },
    { key: "description", label: "Description" },
  ];
  const fields: Field[] = [
    { name: "name", label: "Name", type: "text", required: true },
    {
      name: "parent_id",
      label: "Parent category",
      type: "select",
      options: categories.map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "description", label: "Description", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader title="Categories" description="Product / component categories. Supports a parent for grouping." />
      <CrudManager
        title="Categories"
        entityName="category"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials
        searchKeys={["name", "description"]}
      />
    </div>
  );
}

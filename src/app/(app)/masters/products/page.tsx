import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { getCategories } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function ProductsPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const supabase = await createClient();
  const [{ data: products }, categories] = await Promise.all([
    supabase.from("products").select("*").order("sku_code"),
    getCategories(),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const rows = (products ?? []).map((p) => ({
    ...p,
    category_name: p.category_id ? catById.get(p.category_id) ?? "—" : null,
  }));

  const columns: Column[] = [
    { key: "sku_code", label: "SKU" },
    { key: "model_name", label: "Model" },
    { key: "category_name", label: "Category" },
    { key: "is_serialized", label: "Serialized", format: "bool" },
  ];
  const fields: Field[] = [
    { name: "sku_code", label: "SKU code", type: "text", required: true, placeholder: "TRITON-12K" },
    { name: "model_name", label: "Model name", type: "text", required: true, placeholder: "Triton 12K" },
    {
      name: "category_id",
      label: "Category",
      type: "select",
      options: (categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    { name: "is_serialized", label: "Serialized finished good", type: "checkbox", defaultChecked: true },
    { name: "description", label: "Description", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description="SKU templates (Triton & media-filter families). Open a product to define its variant parameters."
      />
      <CrudManager
        title="Products"
        entityName="product"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials
        searchKeys={["sku_code", "model_name"]}
        detailBase="/masters/products"
      />
    </div>
  );
}

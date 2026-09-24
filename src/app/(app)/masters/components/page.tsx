import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canSeeFinancials } from "@/lib/auth";
import { getComponents, getVendors } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function ComponentsPage() {
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  // team_member reads the column-masked safe view (no standard_cost)
  const [data, vendors, { data: templates }] = await Promise.all([
    getComponents(finance),
    getVendors(),
    supabase.from("inspection_templates").select("id, name").eq("is_active", true).order("name"),
  ]);
  const assemblies = data.filter((c) => c.is_assembly);
  const vendorOptions = (vendors ?? []).map((v) => ({ value: v.id, label: v.name }));
  const assemblyLabel = new Map((assemblies ?? []).map((a) => [a.id, `${a.component_no} — ${a.name}`]));
  const templateOptions = (templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  const templateLabel = new Map((templates ?? []).map((t) => [t.id, t.name]));

  // enrich rows with a readable sub-assembly label for the list column
  const rows = (data ?? []).map((r) => ({
    ...r,
    parent_assembly_label: r.parent_assembly_id ? assemblyLabel.get(r.parent_assembly_id) ?? "—" : "—",
    inspection_template_label: r.inspection_template_id ? templateLabel.get(r.inspection_template_id) ?? "—" : "—",
  }));

  const columns: Column[] = [
    { key: "component_no", label: "WPC" },
    { key: "mpn", label: "MPN" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "grade", label: "Grade" },
    { key: "parent_assembly_label", label: "Sub-assembly" },
    { key: "is_assembly", label: "Assembly", format: "bool" },
    { key: "inspection_template_label", label: "Inspection" },
    { key: "standard_cost", label: "Std Cost", format: "inr", financial: true },
  ];

  const fields: Field[] = [
    { name: "component_no", label: "WPC (Webber Part Code)", type: "text", required: true },
    { name: "mpn", label: "MPN (Manufacturer Part No.)", type: "text", placeholder: "e.g. 1N4148" },
    { name: "name", label: "Name", type: "text", required: true },
    { name: "type", label: "Category", type: "text", placeholder: "Nozzle, Fastener, Media…" },
    { name: "grade", label: "Grade", type: "text", placeholder: "MS, SS316, Brass…" },
    { name: "spec", label: "Spec", type: "text", placeholder: 'e.g. 12", #150' },
    { name: "raw_supplier_id", label: "Supplier", type: "combobox", options: vendorOptions, help: "Vendor this component is bought from." },
    { name: "standard_cost", label: "Standard cost (₹)", type: "number", step: "any", financial: true },
    {
      name: "inspection_template_id",
      label: "Inspection template",
      type: "select",
      options: templateOptions,
      help: "Requires an IRN (inspection) before goods received at GRN become stock.",
    },
    { name: "description", label: "Description", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Components"
        description="The component master — component numbers that BOM lines, POs and inventory lots reference. Includes attributes, vendor tags and QR/lot tracking."
      />
      <CrudManager
        title="Components"
        entityName="component"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials={finance}
        searchKeys={["component_no", "mpn", "name", "type", "grade"]}
        dialogClassName="max-w-2xl"
        hiddenValues={{ tracking_mode: "box", quantity_type: "nos", uom: "Nos" }}
      />
    </div>
  );
}

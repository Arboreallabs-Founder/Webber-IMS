import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteComponents, canSeeFinancials, canManageUsers, requirePathAccess } from "@/lib/auth";
import { getComponents, getVendors } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function ComponentsPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  // team_member reads the column-masked safe view (no standard_cost)
  const [data, vendors, { data: templates }, { data: mpnRows }, { data: altRows }] = await Promise.all([
    getComponents(finance),
    getVendors(),
    supabase.from("inspection_templates").select("id, name").eq("is_active", true).order("name"),
    // One component can carry several MPNs (one per manufacturer it's sourced
    // from) — fetched separately since it's a child list, not a column.
    supabase.from("component_mpns").select("component_id, mpn").order("created_at"),
    // Approved alternatives — symmetric, so a plain filter on component_id
    // already returns the full set regardless of which side it was added from.
    supabase.from("component_alternatives").select("component_id, alternative_id"),
  ]);
  const assemblies = data.filter((c) => c.is_assembly);
  const vendorOptions = (vendors ?? []).map((v) => ({ value: v.id, label: v.name }));
  const assemblyLabel = new Map((assemblies ?? []).map((a) => [a.id, `${a.component_no} — ${a.name}`]));
  const templateOptions = (templates ?? []).map((t) => ({ value: t.id, label: t.name }));

  const templateLabel = new Map((templates ?? []).map((t) => [t.id, t.name]));

  const mpnsByComponent = new Map<string, string[]>();
  for (const m of mpnRows ?? []) {
    (mpnsByComponent.get(m.component_id) ?? mpnsByComponent.set(m.component_id, []).get(m.component_id)!).push(m.mpn);
  }

  const alternativesByComponent = new Map<string, string[]>();
  for (const a of altRows ?? []) {
    (alternativesByComponent.get(a.component_id) ?? alternativesByComponent.set(a.component_id, []).get(a.component_id)!).push(a.alternative_id);
  }
  const componentLabel = new Map((data ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const alternativeOptions = (data ?? []).map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` }));

  // enrich rows with a readable sub-assembly label for the list column
  const rows = (data ?? []).map((r) => {
    const mpns = mpnsByComponent.get(r.id) ?? [];
    const altIds = alternativesByComponent.get(r.id) ?? [];
    return {
      ...r,
      parent_assembly_label: r.parent_assembly_id ? assemblyLabel.get(r.parent_assembly_id) ?? "—" : "—",
      inspection_template_label: r.inspection_template_id ? templateLabel.get(r.inspection_template_id) ?? "—" : "—",
      mpn_display: mpns.join(", "),
      // Textarea default value — one per line, so editing shows the same shape it's typed in.
      mpns: mpns.join("\n"),
      alternatives_display: altIds.map((id) => componentLabel.get(id) ?? "—").join(", "),
      alternative_ids: altIds.join(","),
    };
  });

  const columns: Column[] = [
    { key: "component_no", label: "WPC" },
    { key: "mpn_display", label: "MPN(s)" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "grade", label: "Grade" },
    { key: "parent_assembly_label", label: "Sub-assembly" },
    { key: "is_assembly", label: "Assembly", format: "bool" },
    { key: "is_consumable", label: "Consumable", format: "bool" },
    { key: "inspection_template_label", label: "Inspection" },
    { key: "alternatives_display", label: "Alternatives" },
    { key: "reorder_level", label: "Min stock", format: "number" },
    { key: "standard_cost", label: "Std Cost", format: "inr", financial: true },
  ];

  const fields: Field[] = [
    { name: "component_no", label: "WPC (Webber Part Code)", type: "text", required: true },
    { name: "name", label: "Name", type: "text", required: true },
    { name: "type", label: "Category", type: "text", placeholder: "Nozzle, Fastener, Media…" },
    { name: "grade", label: "Grade", type: "text", placeholder: "MS, SS316, Brass…" },
    { name: "spec", label: "Spec", type: "text", placeholder: 'e.g. 12", #150' },
    { name: "raw_supplier_id", label: "Supplier", type: "combobox", options: vendorOptions, help: "Vendor this component is bought from." },
    {
      name: "reorder_level",
      label: "Minimum stock",
      type: "number",
      step: "any",
      help: "Keep at least this many in open stock. Below it, the component shows in the Action Center. Leave empty for no minimum.",
    },
    { name: "standard_cost", label: "Standard cost (₹)", type: "number", step: "any", financial: true },
    ...(canManageUsers(profile)
      ? [{ name: "is_consumable", label: "Consumable (bought for stock via the Consumables module; never blocked for a project)", type: "checkbox" as const }]
      : []),
    {
      name: "inspection_template_id",
      label: "Inspection template",
      type: "select",
      options: templateOptions,
      help: "Requires an IRN (inspection) before goods received at GRN become stock.",
    },
    {
      name: "mpns",
      label: "MPN(s) (Manufacturer Part No.)",
      type: "textarea",
      placeholder: "One per line — e.g.\n1N4148\nSMBJ4148",
      help: "The same WPC can be sourced from more than one manufacturer — list each one's MPN on its own line.",
    },
    {
      name: "alternative_ids",
      label: "Approved alternatives",
      type: "tags",
      options: alternativeOptions,
      help: "Components that can substitute for this one — marking one here also marks this one as an alternative for it.",
    },
    { name: "description", label: "Description", type: "textarea" },
  ];

  // Ship only what the list shows and the edit form fills — every other
  // column of every component would otherwise travel to the browser too.
  const keep = new Set(["id", ...columns.map((c) => c.key), ...fields.map((f) => f.name)]);
  const slimRows = rows.map((r) => {
    const out: Record<string, unknown> & { id: string } = { id: r.id };
    for (const [k, v] of Object.entries(r)) if (keep.has(k)) out[k] = v;
    return out;
  });

  return (
    <div>
      <PageHeader
        title="Components"
        description="The component master — component numbers that BOM lines, POs and inventory lots reference. Includes attributes, vendor tags and QR/lot tracking."
      />
      <CrudManager
        title="Components"
        entityName="component"
        rows={slimRows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteComponents(profile?.role)}
        canSeeFinancials={finance}
        searchKeys={["component_no", "mpn_display", "name", "type", "grade"]}
        dialogClassName="max-w-2xl"
        hiddenValues={{ tracking_mode: "box", quantity_type: "nos", uom: "Nos" }}
      />
    </div>
  );
}

import { getProfile, canWriteMasters, canSeeFinancials, requirePathAccess, canManageUsers } from "@/lib/auth";
import { getVendors } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

export default async function VendorsPage() {
  await requirePathAccess("/masters");
  const profile = await getProfile();
  const rows = await getVendors();

  const columns: Column[] = [
    { key: "name", label: "Vendor" },
    { key: "gst_no", label: "GST No." },
    { key: "pan", label: "PAN" },
    { key: "contact", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "avg_lead_time_days", label: "Lead (days)", format: "number" },
    { key: "rating", label: "Rating", format: "number" },
    { key: "is_active", label: "Active", format: "bool" },
    { key: "is_consumables_vendor", label: "Consumables", format: "bool" },
  ];
  const fields: Field[] = [
    { name: "name", label: "Vendor name", type: "text", required: true },
    { name: "gst_no", label: "GST No.", type: "text" },
    { name: "pan", label: "PAN", type: "text" },
    { name: "contact", label: "Contact", type: "text" },
    { name: "email", label: "Email", type: "text" },
    { name: "website", label: "Website", type: "text" },
    { name: "avg_lead_time_days", label: "Avg lead time (days)", type: "number" },
    { name: "rating", label: "Rating (0–5)", type: "number", step: "any" },
    { name: "is_active", label: "Active", type: "checkbox", defaultChecked: true },
    ...(canManageUsers(profile)
      ? [{ name: "is_consumables_vendor", label: "Consumables vendor (consumables are ordered from them in the Consumables module)", type: "checkbox" as const }]
      : []),
    { name: "address", label: "Address", type: "textarea" },
  ];

  return (
    <div>
      <PageHeader
        title="Vendors"
        description="Suppliers. Open a vendor to map which components they supply (powers phone-order matching)."
      />
      <CrudManager
        title="Vendors"
        entityName="vendor"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials={canSeeFinancials(profile?.role)}
        searchKeys={["name", "gst_no", "contact"]}
        detailBase="/masters/vendors"
      />
    </div>
  );
}

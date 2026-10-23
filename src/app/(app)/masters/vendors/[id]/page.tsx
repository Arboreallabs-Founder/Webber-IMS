import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canSeeFinancials, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsertVendorComponent, removeVendorComponent } from "../actions";
import { readAll } from "@/lib/server/read-all";

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/masters");
  const { id } = await params;
  const profile = await getProfile();
  const finance = canSeeFinancials(profile?.role);
  const supabase = await createClient();

  const { data: vendor } = await supabase.from("vendors").select("*").eq("id", id).single();
  if (!vendor) notFound();

  const [{ data: vcs }, components] = await Promise.all([
    supabase.from("vendor_components").select("*").eq("vendor_id", id),
    readAll((f, t) => supabase.from("components").select("id, component_no, name").order("component_no").order("id").range(f, t)),
  ]);

  const compById = new Map((components ?? []).map((c) => [c.id, `${c.component_no} — ${c.name}`]));
  const rows = (vcs ?? []).map((vc) => ({ ...vc, component_label: compById.get(vc.component_id) ?? "—" }));

  const columns: Column[] = [
    { key: "component_label", label: "Component" },
    { key: "vendor_part_code", label: "Vendor Part Code" },
    { key: "lead_time_days", label: "Lead (days)", format: "number" },
    { key: "price", label: "Price", format: "inr", financial: true },
  ];
  const fields: Field[] = [
    {
      name: "component_id",
      label: "Component",
      type: "combobox",
      required: true,
      options: (components ?? []).map((c) => ({ value: c.id, label: `${c.component_no} — ${c.name}` })),
    },
    { name: "vendor_part_code", label: "Vendor part code", type: "text" },
    { name: "lead_time_days", label: "Lead time (days)", type: "number" },
    { name: "price", label: "Price (₹)", type: "number", step: "any", financial: true },
  ];

  return (
    <div>
      <Link href="/masters/vendors" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All vendors
      </Link>
      <PageHeader title={vendor.name} description="Components this vendor supplies." />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <Info label="GST No." value={vendor.gst_no} />
          <Info label="PAN" value={vendor.pan} />
          <Info label="Contact" value={vendor.contact} />
          <Info label="Email" value={vendor.email} />
          <Info label="Website" value={vendor.website} />
          <Info label="Lead time" value={vendor.avg_lead_time_days ? `${vendor.avg_lead_time_days} days` : null} />
          <Info label="Rating" value={vendor.rating?.toString()} />
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Supplied components
      </h2>
      <CrudManager
        title="Supplied components"
        entityName="mapping"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsertVendorComponent}
        deleteAction={removeVendorComponent}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials={finance}
        searchKeys={["component_label", "vendor_part_code"]}
        hiddenValues={{ vendor_id: id }}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value || "—"}</p>
    </div>
  );
}

import Link from "next/link";
import { Wrench, ClipboardCheck, Truck, Users, ShieldCheck, Hammer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";

const MASTERS = [
  { label: "BOM Builder", href: "/masters/bom-builder", description: "Create, edit, duplicate, and delete product BOMs, variants, categories, and sub-assemblies.", icon: Hammer },
  { label: "Components", href: "/masters/components", description: "Component numbers, attributes, and QR/lot tracking.", icon: Wrench },
  { label: "Inspection Templates", href: "/masters/inspection-templates", description: "Per-item receiving checklist, gated by IRN approval.", icon: ClipboardCheck },
  { label: "Vendors", href: "/masters/vendors", description: "Suppliers, contact details, and supplied components.", icon: Truck },
  { label: "Customers", href: "/masters/customers", description: "Customer master for projects/orders.", icon: Users },
  { label: "Approval Rights", href: "/masters/approval-rights", description: "Who must sign off POs and GRNs.", icon: ShieldCheck },
];

export default function MasterDataPage() {
  return (
    <div>
      <PageHeader
        title="Master Data"
        description="Catalogue and partner reference data that everything else in the app builds on."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MASTERS.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.href} href={m.href}>
              <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
                <CardContent className="flex items-start gap-3 p-5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Icon className="size-4.5" />
                  </span>
                  <div>
                    <p className="font-medium">{m.label}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{m.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

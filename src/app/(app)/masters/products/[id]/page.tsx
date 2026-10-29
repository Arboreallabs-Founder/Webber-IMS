import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VariantParamEditor } from "./variant-param-editor";
import { upsertVariantParam, removeVariantParam } from "../actions";

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/masters");
  const { id } = await params;
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: product } = await supabase.from("products").select("*").eq("id", id).single();
  if (!product) notFound();

  const [{ data: vps }, { data: template }] = await Promise.all([
    supabase.from("product_variant_params").select("*").eq("product_id", id).order("sort_order"),
    supabase.from("bom_templates").select("id, version, is_active").eq("product_id", id).eq("is_active", true).maybeSingle(),
  ]);

  return (
    <div>
      <Link href="/masters/products" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All products
      </Link>
      <PageHeader title={`${product.sku_code} — ${product.model_name}`} description={product.description ?? undefined} />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-6 p-5 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Serialized</p>
            <p className="mt-0.5 font-medium">{product.is_serialized ? "Yes" : "No"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">BOM Template</p>
            <p className="mt-0.5 font-medium">
              {template ? (
                <Link href={`/masters/bom-templates/${template.id}`} className="text-primary hover:underline">
                  v{template.version} (active) →
                </Link>
              ) : (
                <Badge variant="warning">none yet</Badge>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Variant parameters
      </h2>
      <VariantParamEditor
        productId={id}
        params={vps ?? []}
        canWrite={canWriteMasters(profile?.role)}
        upsertAction={upsertVariantParam}
        removeAction={removeVariantParam}
      />
    </div>
  );
}

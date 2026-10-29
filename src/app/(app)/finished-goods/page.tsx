import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, requirePathAccess } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { FgManager } from "./fg-manager";

function variantText(sel: unknown): string {
  if (!sel || typeof sel !== "object") return "";
  return Object.entries(sel as Record<string, unknown>).map(([k, v]) => `${k}: ${v}`).join(", ");
}

export default async function FinishedGoodsPage() {
  await requirePathAccess("/finished-goods");
  const profile = await getProfile();
  const canWrite = canWriteMasters(profile?.role); // admin / team_lead
  const supabase = await createClient();

  const [{ data: fgs }, { data: products }] = await Promise.all([
    supabase.from("finished_goods").select("*").order("created_at", { ascending: false }),
    supabase.from("products").select("id, sku_code, model_name").order("sku_code"),
  ]);

  const prodLabel = new Map((products ?? []).map((p) => [p.id, `${p.sku_code} — ${p.model_name}`]));

  const units = (fgs ?? []).map((u) => ({
    id: u.id,
    serial_no: u.serial_no,
    product_label: u.product_id ? prodLabel.get(u.product_id) ?? "—" : u.custom_name ?? "—",
    status: u.status,
    variant_text: variantText(u.variant_selections),
    created_at: u.created_at,
  }));

  return (
    <div>
      <PageHeader title="Finished Goods" description="Completed units with a serial QR. Status: in production → ready → dispatched (set by dispatching from the project's Materials issued tab). Click a serial to see its components." />
      <FgManager units={units} canWrite={canWrite} />
    </div>
  );
}

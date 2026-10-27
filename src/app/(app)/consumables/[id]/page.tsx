import { requirePathAccess } from "@/lib/auth";
import { PoDetail } from "../../purchase-orders/[id]/po-detail";

export default async function ConsumablesPoPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePathAccess("/consumables");
  const { id } = await params;
  return <PoDetail id={id} scope="consumables" />;
}

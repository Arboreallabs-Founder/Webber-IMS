import { requirePathAccess } from "@/lib/auth";
import { PoListPage } from "../purchase-orders/po-list-page";

export default async function ConsumablesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePathAccess("/consumables");
  const { tab = "all" } = await searchParams;
  return <PoListPage scope="consumables" tab={tab} />;
}

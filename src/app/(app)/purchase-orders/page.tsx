import { PoListPage } from "./po-list-page";

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "all" } = await searchParams;
  return <PoListPage scope="normal" tab={tab} />;
}

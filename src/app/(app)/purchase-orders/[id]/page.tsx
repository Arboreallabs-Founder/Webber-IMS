import { PoDetail } from "./po-detail";

export default async function PoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PoDetail id={id} scope="normal" />;
}

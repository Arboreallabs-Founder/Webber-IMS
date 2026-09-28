import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { InternalConsumptionList } from "./internal-consumption-list";
import { upsert, remove } from "./actions";

export default async function InternalConsumptionPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const { data: records } = await supabase
    .from("projects")
    .select("id, project_no, status, delivery_date, department, consumption_reason")
    .eq("is_internal", true)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Internal Consumption"
        description="Stock drawn for internal use — R&D, testing, rework — with no customer or sale involved."
      />
      <InternalConsumptionList
        records={records ?? []}
        canWrite={canWriteMasters(profile?.role)}
        upsertAction={upsert}
        deleteAction={remove}
      />
    </div>
  );
}

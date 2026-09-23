import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { CustomerManager } from "./customer-manager";
import { upsert, remove } from "./actions";

export default async function CustomersPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const data = await getCustomers();
  const rows = data ?? [];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Buyers of our products. Customers are linked to Projects / Orders."
      />
      <CustomerManager
        rows={rows}
        canWrite={canWriteMasters(profile?.role)}
        upsertAction={upsert}
        deleteAction={remove}
      />
    </div>
  );
}

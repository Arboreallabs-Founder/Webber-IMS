import { createClient } from "@/lib/supabase/server";
import { getProfile, canWriteMasters, canSeeFinancials } from "@/lib/auth";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { ProjectsList } from "./projects-list";
import { upsert, remove } from "./actions";

export default async function ProjectsPage() {
  const profile = await getProfile();
  const supabase = await createClient();

  const [{ data: projects }, customers] = await Promise.all([
    supabase.from("projects").select("*").eq("is_internal", false).order("created_at", { ascending: false }),
    getCustomers(),
  ]);

  const custById = new Map(customers.map((c) => [c.id, c.name]));

  const rows = (projects ?? []).map((p) => ({
    ...p,
    customer_name: p.customer_id ? custById.get(p.customer_id) ?? "—" : null,
  }));

  return (
    <div>
      <PageHeader
        title="Projects / Orders"
        description="Customer orders. Open a project to add line items and generate its BOM."
      />
      <ProjectsList
        projects={rows}
        customers={customers ?? []}
        canWrite={canWriteMasters(profile?.role)}
        canSeeFinancials={canSeeFinancials(profile?.role)}
        upsertAction={upsert}
        deleteAction={remove}
      />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { getCustomers } from "@/lib/masters-data";
import { PageHeader } from "@/components/page-header";
import { projectLabel } from "@/lib/utils";
import { RequisitionsTable } from "./requisitions-table";

export default async function RequisitionsPage() {
  const supabase = await createClient();
  const [{ data: reqs }, { data: projects }, { data: lines }, customers] = await Promise.all([
    supabase.from("requisitions").select("*").order("created_at", { ascending: false }),
    supabase.from("projects").select("id, project_no, customer_id").order("project_no"),
    supabase.from("requisition_lines").select("requisition_id"),
    getCustomers(),
  ]);

  const custName = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const projectsWithCustomer = (projects ?? []).map((p) => ({ ...p, customer_name: p.customer_id ? custName.get(p.customer_id) ?? null : null }));
  const projById = new Map(projectsWithCustomer.map((p) => [p.id, projectLabel(p)]));
  const lineCount = new Map<string, number>();
  for (const l of lines ?? []) lineCount.set(l.requisition_id, (lineCount.get(l.requisition_id) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="Requisitions"
        description="Indents raised from projects and internal consumption."
      />
      <RequisitionsTable
        reqs={(reqs ?? []).map((r) => ({
          id: r.id,
          req_no: r.req_no,
          project_id: r.project_id,
          project_label: r.project_id ? projById.get(r.project_id) ?? null : null,
          status: r.status,
          line_count: lineCount.get(r.id) ?? 0,
          created_at: r.created_at,
        }))}
      />
    </div>
  );
}

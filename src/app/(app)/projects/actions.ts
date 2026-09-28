"use server";

import { upsertRecord, deleteRecord, type ActionResult } from "@/lib/server/crud";
import { createClient } from "@/lib/supabase/server";

const FIELDS = {
  project_no: "string",
  customer_id: "string",
  customer_po_number: "string",
  customer_po_value: "number",
  order_date: "string",
  delivery_date: "string",
  status: "string",
  is_internal: "boolean",
  department: "string",
  consumption_reason: "string",
} as const;

export async function upsert(fd: FormData): Promise<ActionResult> {
  return upsertRecord("projects", FIELDS, fd);
}
export async function remove(fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "Missing id." };
  const sections = await projectDataSections(id);
  if (sections.length) {
    return { error: `Can't delete — this project still has data in: ${sections.join(", ")}.` };
  }
  return deleteRecord("projects", fd);
}

/** Sections (app-facing names) holding data that blocks a project delete via FK restrict. */
async function projectDataSections(projectId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const checks: [string, Promise<{ count: number | null }>][] = [
    ["Requisitions", supabase.from("requisitions").select("id", { count: "exact", head: true }).eq("project_id", projectId)],
    ["Purchase Orders", supabase.from("po_lines").select("id", { count: "exact", head: true }).eq("project_id", projectId)],
    ["Goods Receipt", supabase.from("grn_lines").select("id", { count: "exact", head: true }).eq("project_id", projectId)],
    ["Inventory", supabase.from("inventory_lots").select("id", { count: "exact", head: true }).eq("project_id", projectId)],
    ["Inventory", supabase.from("stock_movements").select("id", { count: "exact", head: true }).eq("project_id", projectId)],
    [
      "Finished Goods",
      supabase
        .from("finished_goods")
        .select("id, project_line_items!inner(project_id)", { count: "exact", head: true })
        .eq("project_line_items.project_id", projectId),
    ],
  ];
  const results = await Promise.all(checks.map(([, q]) => q));
  const sections = new Set<string>();
  results.forEach((r, i) => {
    if ((r.count ?? 0) > 0) sections.add(checks[i][0]);
  });
  return [...sections];
}

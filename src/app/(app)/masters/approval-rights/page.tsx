import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { CrudManager, type Column, type Field } from "@/components/crud/crud-manager";
import { upsert, remove } from "./actions";

const DOC_TYPE_LABEL: Record<string, string> = {
  po: "Purchase Order",
  grn: "GRN",
};
const SLOT_LABEL: Record<number, string> = { 2: "2nd signer", 3: "3rd signer" };

export default async function ApprovalRightsPage() {
  const profile = await getProfile();
  const supabase = await createClient();
  const [{ data: rights }, { data: users }] = await Promise.all([
    supabase.from("approval_rights").select("*").order("document_type").order("approver_order"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name]));
  const rows = (rights ?? []).map((r) => ({
    ...r,
    document_type_label: DOC_TYPE_LABEL[r.document_type] ?? r.document_type,
    slot_label: SLOT_LABEL[r.approver_order] ?? String(r.approver_order),
    approver_name: nameById.get(r.user_id) ?? "—",
  }));

  const columns: Column[] = [
    { key: "document_type_label", label: "Document" },
    { key: "slot_label", label: "Slot" },
    { key: "approver_name", label: "Approver" },
  ];
  const fields: Field[] = [
    {
      name: "document_type",
      label: "Document type",
      type: "select",
      required: true,
      options: Object.entries(DOC_TYPE_LABEL).map(([value, label]) => ({ value, label })),
    },
    {
      name: "approver_order",
      label: "Slot",
      type: "select",
      required: true,
      options: [{ value: "2", label: "2nd signer" }, { value: "3", label: "3rd signer" }],
    },
    {
      name: "user_id",
      label: "Approver",
      type: "combobox",
      required: true,
      options: (users ?? []).map((u) => ({ value: u.id, label: u.full_name ?? "—" })),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Approval Rights"
        description="Who must sign off Purchase Orders and GRNs before the creator's own signature (slot 1) is enough. The creator always signs first; a document is sent/printable once every configured slot below is signed."
      />
      <CrudManager
        title="Approval Rights"
        entityName="approval right"
        rows={rows}
        columns={columns}
        fields={fields}
        upsertAction={upsert}
        deleteAction={remove}
        canWrite={profile?.role === "admin"}
        canSeeFinancials
        searchKeys={["document_type_label", "approver_name"]}
      />
    </div>
  );
}

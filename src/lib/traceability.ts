/**
 * Shape of the `get_lot_traceability` RPC payload.
 *
 * Client-safe on purpose — no `server-only` import — because both the client
 * scanner (`traceability-scanner.tsx`) and the server route
 * (`traceability/[lotCode]/page.tsx`) need these types. Same split as
 * `src/lib/roles.ts` vs `src/lib/auth.ts`: the types live here, the fetch that
 * uses them lives in `src/lib/server/traceability.ts`.
 */

export type Lot = {
  id: string; lot_code: string; component_id: string | null; status: string;
  qty_on_hand: number; qty_initial: number; unit_cost: number | null; jw_stage: string | null;
  created_at: string; component_no?: string; component_name?: string;
};
export type LineageEntry = { lot_id: string; lot_code: string; jw_stage: string | null; created_at: string };
export type PurchaseOrder = { po_no: string | null; po_date: string | null; raised_by: string | null; vendor_name: string | null; qty_ordered: number | null; rate: number | null };
export type Grn = { grn_no: string | null; challan_no: string | null; invoice_no: string | null; received_by: string | null; received_at: string | null; is_untagged: boolean | null };
export type ChecklistEntry = { label: string; field_type: string; value: string | null };
export type Irn = {
  irn_no: string; status: string; template_name: string | null; generated_by: string | null; generated_at: string;
  approved_by: string | null; approved_at: string | null; rejection_reason: string | null; approval_remarks: string | null;
  checklist: ChecklistEntry[];
};
export type Movement = { movement_type: string; qty: number; project_no: string | null; reference_type: string | null; reference_id: string | null; performed_by: string | null; performed_at: string; note: string | null };
export type Traceability = { lot: Lot; lineage: LineageEntry[]; purchase_order: PurchaseOrder | null; grn: Grn | null; irn: Irn[]; movements: Movement[] };

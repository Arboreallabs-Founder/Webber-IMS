import type { Database } from "@/lib/database.types";

// Client-safe role constants & pure helpers (no server-only imports).
export type Role = Database["public"]["Enums"]["role"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  founder: "Founder",
  team_lead: "Team Lead",
  team_member: "Team Member",
  viewer: "Viewer",
  floor: "Inventory Floor",
};

/**
 * Roles permitted to see pricing / financial columns.
 * 'floor' (Inventory Floor) must NEVER be added here — a hard business rule:
 * floor staff never see any price or cost, anywhere.
 */
export const FINANCE_ROLES: Role[] = ["admin", "founder", "team_lead"];

export function canSeeFinancials(role: Role | undefined | null) {
  return !!role && FINANCE_ROLES.includes(role);
}

/** Excel exports, the PO register, and PO print-outs — none for Inventory Floor. */
export function canDownloadReports(role: Role | undefined | null) {
  return !!role && role !== "floor";
}

/**
 * Inventory Floor sees only these areas (allowlist, so a new page stays hidden
 * from them until deliberately added). Every other role sees everything.
 */
const FLOOR_PATHS = ["/requisitions", "/purchase-orders", "/grn", "/inventory", "/traceability", "/account"];

export function canAccessPath(role: Role | undefined | null, path: string) {
  if (role !== "floor") return true;
  return FLOOR_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Where a role lands instead of the dashboard. */
export function homePathFor(role: Role | undefined | null) {
  return role === "floor" ? "/grn" : "/";
}

export function canWriteMasters(role: Role | undefined | null) {
  return role === "admin" || role === "team_lead";
}

/**
 * Deleting a purchase order is irreversible — restricted tighter than
 * normal PO management:
 * - Admin or Founder can delete ANY PO — draft, sent, a revision, or an
 *   original that's been revised. They're the escape hatch for cleaning
 *   up mistakes/test data even inside a revision chain.
 * - Team Lead can only delete a `draft` that has never been part of a
 *   revision (`revision_no === 0` and `superseded_by === null`).
 * Mirrors the `po_del` RLS policy exactly (the RLS policy is the real
 * backstop). The two self-referencing FKs (`root_po_id`/`superseded_by`)
 * are `on delete set null`, so deleting a link in a chain cleanly detaches
 * it rather than failing — no orphan-cleanup logic needed here.
 */
export function canDeletePurchaseOrders(
  role: Role | undefined | null,
  po?: { status: string; revision_no: number; superseded_by: string | null } | null,
) {
  if (!role || !po) return false;
  if (role === "admin" || role === "founder") return true;
  if (role === "team_lead") return po.status === "draft" && po.revision_no === 0 && po.superseded_by === null;
  return false;
}

/**
 * Approving a PO line's price is gated to the configured PO approver
 * (Masters → Approval Rights, document_type='po', slot 2) — falls back to
 * Admin-only if that hasn't been configured yet, so nothing breaks before
 * an admin sets it up. Mirrors the same fallback logic in the
 * `approve_po_line`/`reject_po_line` RPCs (the real backstop).
 */
export function canApprovePoLine(
  role: Role | undefined | null,
  userId: string | undefined | null,
  poApproverId: string | null,
) {
  if (!userId) return false;
  if (poApproverId) return userId === poApproverId;
  return role === "admin";
}

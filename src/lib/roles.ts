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
  accounts: "Accounts (Viewer)",
};

/**
 * Roles permitted to see pricing / financial columns.
 * 'accounts' is a read-only Viewer that sees prices (on screen and in reports).
 * 'floor' (Inventory Floor) must NEVER be added here — a hard business rule:
 * floor staff never see any price or cost, anywhere.
 */
export const FINANCE_ROLES: Role[] = ["admin", "founder", "team_lead", "accounts"];

export function canSeeFinancials(role: Role | undefined | null) {
  return !!role && FINANCE_ROLES.includes(role);
}

/** Excel exports, the PO register, and PO print-outs — none for Inventory Floor. */
export function canDownloadReports(role: Role | undefined | null) {
  return !!role && role !== "floor";
}

/**
 * Factory Admin: an Admin (role 'admin') with `is_factory_admin` set. Has every
 * Admin permission except approving project BOMs (submits them instead),
 * Approval Rights and user management. The database enforces all three.
 */
type RoleHolder = { role: Role; is_factory_admin?: boolean | null } | null | undefined;

export function isFactoryAdmin(p: RoleHolder) {
  return !!p && p.role === "admin" && !!p.is_factory_admin;
}

/** The role as shown on screen — "Factory Admin" for a flagged Admin. */
export function roleLabel(p: RoleHolder) {
  if (!p) return "";
  return isFactoryAdmin(p) ? "Factory Admin" : ROLE_LABELS[p.role];
}

/** Choices on the Users screen: the roles, plus Factory Admin right after Admin. */
export type RoleChoice = Role | "factory_admin";
export const ROLE_CHOICES: { value: RoleChoice; label: string }[] = (Object.keys(ROLE_LABELS) as Role[]).flatMap(
  (r): { value: RoleChoice; label: string }[] =>
    r === "admin"
      ? [{ value: r, label: ROLE_LABELS[r] }, { value: "factory_admin", label: "Factory Admin" }]
      : [{ value: r, label: ROLE_LABELS[r] }],
);

export function roleChoiceOf(p: { role: Role; is_factory_admin?: boolean | null }): RoleChoice {
  return isFactoryAdmin(p) ? "factory_admin" : p.role;
}

/** Turns a Users-screen choice into what is stored on the profile. */
export function profileRoleFields(choice: string): { role: Role; is_factory_admin: boolean } {
  if (choice === "factory_admin") return { role: "admin", is_factory_admin: true };
  const role = (Object.keys(ROLE_LABELS) as Role[]).includes(choice as Role) ? (choice as Role) : "team_member";
  return { role, is_factory_admin: false };
}

/** Approving a project BOM: Admin or Team Lead, never a Factory Admin. */
export function canApproveBom(p: RoleHolder) {
  return !!p && (p.role === "admin" || p.role === "team_lead") && !isFactoryAdmin(p);
}

/** Creating users and changing roles: full Admin only. */
export function canManageUsers(p: RoleHolder) {
  return !!p && p.role === "admin" && !isFactoryAdmin(p);
}

const FACTORY_ADMIN_BLOCKED_PATHS = ["/masters/approval-rights", "/admin/users"];

/**
 * Inventory Floor sees only these areas (allowlist, so a new page stays hidden
 * from them until deliberately added). Every other role sees everything.
 */
const FLOOR_PATHS = ["/requisitions", "/purchase-orders", "/consumables", "/grn", "/inventory", "/traceability", "/account"];

export function canAccessPath(role: Role | undefined | null, path: string, factoryAdmin = false) {
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  if (factoryAdmin && FACTORY_ADMIN_BLOCKED_PATHS.some(under)) return false;
  if (role !== "floor") return true;
  return FLOOR_PATHS.some(under);
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

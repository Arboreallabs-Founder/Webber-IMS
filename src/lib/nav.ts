import type { Role } from "@/lib/roles";

export type NavItem = {
  label: string;
  href: string;
  /** Roles allowed to see this item. Empty = all signed-in roles. */
  roles?: Role[];
  /** Milestone status — items not yet built are shown disabled. */
  status?: "live" | "soon";
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/", status: "live" },
      { label: "Master Data", href: "/masters", status: "live" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Projects / Orders", href: "/projects", status: "live" },
      { label: "Internal Consumption", href: "/internal-consumption", status: "live" },
      { label: "Requisitions", href: "/requisitions", status: "live" },
      { label: "Purchase Orders", href: "/purchase-orders", status: "live" },
      { label: "Goods Receipt", href: "/grn", status: "live" },
      { label: "Inventory", href: "/inventory", status: "live" },
      { label: "Traceability", href: "/traceability", status: "live" },
      { label: "Finished Goods", href: "/finished-goods", status: "live" },
    ],
  },
  {
    title: "Insight",
    items: [
      { label: "Action Center", href: "/reconciliation", status: "live" },
      { label: "Supplier KPIs", href: "/suppliers", status: "live" },
    ],
  },
  {
    title: "Admin",
    items: [{ label: "Users", href: "/admin/users", roles: ["admin", "founder"], status: "live" }],
  },
];

export function visibleGroups(role: Role): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || i.roles.includes(role)),
  })).filter((g) => g.items.length > 0);
}

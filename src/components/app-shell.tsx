"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu, X, LogOut, ChevronsUpDown, Circle,
  LayoutDashboard, Database,
  FolderKanban, ClipboardList, ShoppingCart, PackageCheck, Warehouse,
  Package, AlertTriangle, Gauge, UserCog, ScanLine, PenLine, Factory,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleGroups, type NavGroup } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { NotificationBell, type NotificationItem } from "@/components/notification-bell";
import { logout } from "@/app/(app)/actions";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/masters": Database,
  "/projects": FolderKanban,
  "/internal-consumption": Factory,
  "/requisitions": ClipboardList,
  "/purchase-orders": ShoppingCart,
  "/grn": PackageCheck,
  "/inventory": Warehouse,
  "/traceability": ScanLine,
  "/finished-goods": Package,
  "/reconciliation": AlertTriangle,
  "/suppliers": Gauge,
  "/admin/users": UserCog,
};

export function AppShell({
  fullName,
  email,
  role,
  notifications = [],
  children,
}: {
  fullName: string | null;
  email: string | undefined;
  role: Role;
  notifications?: NotificationItem[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(true);
  const [open, setOpen] = useState(false);
  const groups = visibleGroups(role);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop hover-expand rail */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-full overflow-hidden border-r border-border bg-white shadow-sm lg:block print:hidden",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-14" : "w-64",
        )}
        onMouseEnter={() => setCollapsed(false)}
        onMouseLeave={() => setCollapsed(true)}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-border px-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              WE
            </span>
            <span
              className={cn(
                "whitespace-nowrap font-semibold transition-opacity duration-150",
                collapsed ? "opacity-0" : "opacity-100",
              )}
            >
              Webber IMS
            </span>
          </div>
          <ScrollArea className="flex-1">
            <NavList groups={groups} pathname={pathname} expanded={!collapsed} />
          </ScrollArea>
          <Account expanded={!collapsed} fullName={fullName} email={email} role={role} />
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col bg-white shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4 pt-[env(safe-area-inset-top)]">
              <span className="flex items-center gap-2 font-semibold">
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  WE
                </span>
                Webber IMS
              </span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="flex size-11 items-center justify-center -mr-2">
                <X className="size-5" />
              </button>
            </div>
            <ScrollArea className="flex-1">
              <NavList groups={groups} pathname={pathname} expanded onNavigate={() => setOpen(false)} />
            </ScrollArea>
            <Account expanded fullName={fullName} email={email} role={role} />
          </aside>
        </div>
      )}

      {/* Content offset by collapsed rail width */}
      <div className="lg:pl-14 print:pl-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-white px-4 pt-[env(safe-area-inset-top)] lg:px-8 print:hidden">
          <button className="flex size-11 items-center justify-center -ml-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {(role === "admin" || role === "team_lead") && <NotificationBell notifications={notifications} />}
            <span className="hidden text-muted-foreground sm:inline">{fullName ?? email}</span>
            <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">
              {ROLE_LABELS[role]}
            </span>
          </div>
        </header>
        <main className="p-4 mb-[env(safe-area-inset-bottom)] lg:p-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}

function NavList({
  groups,
  pathname,
  expanded,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col p-2">
      {groups.map((g, gi) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          {gi > 0 && <Separator className="my-1.5" />}
          {expanded && (
            <p className="whitespace-nowrap px-2.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {g.title}
            </p>
          )}
          {g.items.map((item) => {
            const Icon = ICONS[item.href] ?? Circle;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const soon = item.status === "soon";
            const base = "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors";
            if (soon) {
              return (
                <span key={item.href} title={`${item.label} (soon)`} className={cn(base, "cursor-not-allowed text-slate-400")}>
                  <Icon className="size-4 shrink-0" />
                  {expanded && <span className="whitespace-nowrap">{item.label}</span>}
                  {expanded && (
                    <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">soon</span>
                  )}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                onClick={onNavigate}
                className={cn(
                  base,
                  "relative font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-slate-600 hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <NavItemContent Icon={Icon} label={item.label} expanded={expanded} active={active} />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * Inner content of a nav link. Must be a child of `<Link>` — `useLinkStatus()`
 * reports that link's own pending state, so the tab the user clicked shows a
 * spinner and highlights itself the instant it is clicked, rather than after
 * the new page has finished loading.
 */
function NavItemContent({
  Icon,
  label,
  expanded,
  active,
}: {
  Icon: LucideIcon;
  label: string;
  expanded: boolean;
  active: boolean;
}) {
  const { pending } = useLinkStatus();

  return (
    <>
      {pending && !active && (
        <span aria-hidden="true" className="absolute inset-0 rounded-md bg-accent" />
      )}
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        {pending ? <Spinner size="sm" label={`Loading ${label}`} /> : <Icon className="size-4" />}
      </span>
      {expanded && <span className="relative whitespace-nowrap">{label}</span>}
    </>
  );
}

function Account({
  expanded,
  fullName,
  email,
  role,
}: {
  expanded: boolean;
  fullName: string | null;
  email: string | undefined;
  role: Role;
}) {
  const initials =
    (fullName ?? email ?? "U")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "U";

  return (
    <div className="shrink-0 border-t border-border p-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button className="flex h-11 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-accent">
            <Avatar className="size-8 shrink-0">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {expanded && (
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{fullName ?? "User"}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</span>
                </span>
                <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground/50" />
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-60">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{fullName ?? "User"}</p>
            <p className="truncate text-xs text-muted-foreground">{email}</p>
            <span className="mt-1 inline-block rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-foreground">
              {ROLE_LABELS[role]}
            </span>
          </div>
          <DropdownMenuSeparator />
          <Link
            href="/account/signature"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            <PenLine className="size-4" /> My Signature
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </form>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { markNotificationRead } from "@/app/(app)/site-purchases/actions";
import { formatDateTime } from "@/lib/utils";

export type NotificationItem = { id: string; message: string; link_path: string | null; created_at: string };

export function NotificationBell({ notifications }: { notifications: NotificationItem[] }) {
  const [items, setItems] = React.useState(notifications);

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    const fd = new FormData();
    fd.set("notification_id", id);
    await markNotificationRead(fd);
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
          {items.length > 0 && (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
              {items.length > 9 ? "9+" : items.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-80">
        <div className="px-2 py-1.5 text-sm font-medium">Notifications</div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {items.map((n) => (
              <div key={n.id} className="flex items-start gap-2 px-2 py-2 text-sm hover:bg-accent">
                <div className="min-w-0 flex-1">
                  {n.link_path ? (
                    <Link href={n.link_path} className="block hover:underline">{n.message}</Link>
                  ) : (
                    <p>{n.message}</p>
                  )}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDateTime(n.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => dismiss(n.id)}
                  aria-label="Mark read"
                  title="Mark read"
                  className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Check className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

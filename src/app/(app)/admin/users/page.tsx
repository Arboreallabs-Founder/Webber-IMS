import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePathAccess, requireRole } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { UsersManager } from "./users-manager";
import { ActivityLogTable, type LogRow } from "./activity-log-table";
import { formatActivity, type ActivityRow } from "@/lib/activity-log/format";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = [
  { value: "", label: "All types" },
  { value: "audit", label: "Changes" },
  { value: "stock", label: "Stock" },
  { value: "signature", label: "Signatures" },
  { value: "notification", label: "Notifications" },
];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; category?: string; actor?: string; from?: string; to?: string }>;
}) {
  await requirePathAccess("/admin/users");
  const profile = await requireRole(["admin", "founder"]);
  const isAdmin = profile.role === "admin";
  const { tab: tabParam, category = "", actor = "", from = "", to = "" } = await searchParams;
  const tab = isAdmin ? (tabParam ?? "list") : "log";

  return (
    <div>
      <PageHeader
        title="Users"
        description={
          tab === "list"
            ? "Provision sign-ins and assign roles. There is no public signup — accounts are created here."
            : "Who did what, when, and where — across the whole app."
        }
      />

      {isAdmin && (
        <div className="mb-6 flex gap-1 border-b border-border">
          <Link
            href="/admin/users"
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === "list" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Users
          </Link>
          <Link
            href="/admin/users?tab=log"
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab === "log" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Log
          </Link>
        </div>
      )}

      {tab === "log" ? <ActivityLogTab category={category} actor={actor} from={from} to={to} /> : <UsersListTab />}
    </div>
  );
}

async function UsersListTab() {
  const supabase = await createClient();
  const { data: users } = await supabase.rpc("admin_list_users");
  return <UsersManager users={users ?? []} />;
}

async function ActivityLogTab({ category, actor, from, to }: { category: string; actor: string; from: string; to: string }) {
  const supabase = await createClient();

  let query = supabase.from("v_activity_log").select("*").order("occurred_at", { ascending: false }).limit(300);
  if (category) query = query.eq("category", category);
  if (actor) query = query.eq("actor_id", actor);
  if (from) query = query.gte("occurred_at", `${from}T00:00:00`);
  if (to) query = query.lte("occurred_at", `${to}T23:59:59`);

  const [{ data: rows }, { data: allProfiles }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").order("full_name"),
  ]);

  const nameById = new Map((allProfiles ?? []).map((p) => [p.id, p.full_name]));

  const logRows: LogRow[] = (rows ?? []).map((r, i) => {
    const actorName = r.actor_id ? nameById.get(r.actor_id) ?? null : null;
    const { text, link } = formatActivity(r as unknown as ActivityRow, actorName);
    return {
      key: `${r.category}-${r.row_id ?? "x"}-${r.occurred_at}-${i}`,
      occurred_at: r.occurred_at as string,
      category: r.category as string,
      text,
      link,
      actor_name: actorName ?? "Outside the app",
    };
  });

  return (
    <div>
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <input type="hidden" name="tab" value="log" />
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select name="category" defaultValue={category}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-[180px] space-y-1.5">
          <Label>Person</Label>
          <Select name="actor" defaultValue={actor}>
            <option value="">Everyone</option>
            {(allProfiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>From</Label>
          <Input type="date" name="from" defaultValue={from} />
        </div>
        <div className="space-y-1.5">
          <Label>To</Label>
          <Input type="date" name="to" defaultValue={to} />
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      <ActivityLogTable rows={logRows} />
    </div>
  );
}

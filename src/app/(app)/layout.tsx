import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getProfile } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { logout } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const profile = await getProfile();

  if (!profile || !profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">
            {profile ? "Account deactivated" : "No access yet"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {profile
              ? "Your account has been deactivated. Contact an administrator."
              : "Your sign-in is valid but no profile has been provisioned. Ask an administrator to set up your role and team."}
          </p>
          <form action={logout} className="mt-4">
            <Button variant="outline" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </main>
    );
  }

  let notifications: { id: string; message: string; link_path: string | null; created_at: string }[] = [];
  if (profile.role === "admin" || profile.role === "team_lead") {
    const supabase = await createClient();
    const [{ data: notifs }, { data: reads }] = await Promise.all([
      supabase.from("notifications").select("id, message, link_path, created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("notification_reads").select("notification_id").eq("profile_id", profile.id),
    ]);
    const readSet = new Set((reads ?? []).map((r) => r.notification_id));
    notifications = (notifs ?? []).filter((n) => !readSet.has(n.id));
  }

  return (
    <AppShell fullName={profile.full_name} email={user.email} role={profile.role} factoryAdmin={profile.is_factory_admin} notifications={notifications}>
      {children}
    </AppShell>
  );
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { canManageUsers, profileRoleFields } from "@/lib/roles";

export type ActionResult = { ok?: true; error?: string };

/** Full Admin only — a Factory Admin can't create users or change roles (profiles_mod RLS agrees). */
async function requireAdmin() {
  const profile = await getProfile();
  return canManageUsers(profile) ? profile : null;
}

export async function createUser(fd: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return { error: "Admin only." };
  const supabase = await createClient();
  const body = {
    email: String(fd.get("email") ?? "").trim(),
    password: String(fd.get("password") ?? ""),
    full_name: String(fd.get("full_name") ?? "").trim() || null,
    role: String(fd.get("role") ?? "team_member"),
  };

  const { data, error } = await supabase.functions.invoke("admin-create-user", { body });
  if (error) {
    let msg = error.message;
    try {
      // FunctionsHttpError hides the body in .context (a Response)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ctx = (error as any).context;
      const parsed = ctx?.json ? await ctx.json() : null;
      if (parsed?.error) msg = parsed.error;
    } catch {
      /* ignore */
    }
    return { error: msg };
  }
  if (data?.error) return { error: data.error };
  return { ok: true };
}

export async function updateUser(fd: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admin only." };
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "Missing id." };
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from("profiles") as any)
    .update({
      full_name: String(fd.get("full_name") ?? "").trim() || null,
      ...profileRoleFields(String(fd.get("role") ?? "team_member")),
      is_active: fd.get("is_active") !== null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { ok: true };
}

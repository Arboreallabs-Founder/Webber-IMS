import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { Role } from "@/lib/roles";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Re-export client-safe helpers so server code can import from one place.
export { ROLE_LABELS, FINANCE_ROLES, canSeeFinancials, canWriteMasters, canWriteComponents } from "@/lib/roles";
export type { Role } from "@/lib/roles";

/**
 * Returns the signed-in auth user, or null. Wrapped in React `cache()` so
 * repeated calls within one request/render (layout + page + nested
 * components) share a single `auth.getUser()` round trip instead of each
 * re-fetching it. Scoped per-request by the Next.js server runtime — never
 * shared across users or requests.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** Returns the signed-in user's profile, or null. Cached per-request — see `getAuthUser`. */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return data ?? null;
});

/** Redirects to /login if not signed in or no profile row exists. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** Redirects home if the profile's role is not in `roles`. */
export async function requireRole(roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

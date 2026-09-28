import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const ROLES = ["admin", "founder", "team_lead", "team_member", "inventory_admin"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // 1) Identify the caller and confirm they are an admin.
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: uErr } = await caller.auth.getUser();
  if (uErr || !user) return json({ error: "Not authenticated" }, 401);
  const { data: prof } = await caller.from("profiles").select("role").eq("id", user.id).single();
  if (!prof || prof.role !== "admin") return json({ error: "Admin only" }, 403);

  // 2) Validate input.
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const full_name = body.full_name ? String(body.full_name) : null;
  const role = ROLES.includes(String(body.role)) ? String(body.role) : "team_member";
  if (!email || password.length < 6) return json({ error: "Email and a 6+ char password are required" }, 400);

  // 3) Create the auth user + profile with the service role.
  const admin = createClient(url, service);
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr || !created.user) return json({ error: cErr?.message ?? "Could not create user" }, 400);

  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id, full_name, role, created_by: user.id, is_active: true,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id); // roll back orphaned auth user
    return json({ error: pErr.message }, 400);
  }
  return json({ ok: true, id: created.user.id });
});

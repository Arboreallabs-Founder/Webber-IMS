import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Called by the `trg_notify_push_subscribers` trigger on `notifications`
// (see supabase/migrations/20260901060002_0083_push_notify_trigger.sql) —
// not a user-facing endpoint, so it trusts a shared secret instead of a
// user JWT (this function is deployed with verify_jwt: false).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!webhookSecret || req.headers.get("x-webhook-secret") !== webhookSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  if (!vapidPublicKey || !vapidPrivateKey) return json({ error: "VAPID keys not configured" }, 500);
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  let body: { notification_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const notificationId = body.notification_id;
  if (!notificationId) return json({ error: "notification_id required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service);

  const { data: notification } = await admin
    .from("notifications")
    .select("message, link_path, recipient_id")
    .eq("id", notificationId)
    .maybeSingle();
  if (!notification?.recipient_id) return json({ ok: true, skipped: "no recipient" });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", notification.recipient_id);
  if (!subs || subs.length === 0) return json({ ok: true, sent: 0 });

  const payload = JSON.stringify({
    title: "Webber IMS",
    body: notification.message,
    url: notification.link_path ?? "/",
  });

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        // Subscription is gone (uninstalled, permission revoked, etc.) — clean it up.
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return json({ ok: true, sent });
});

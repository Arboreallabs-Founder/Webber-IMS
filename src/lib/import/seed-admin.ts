/**
 * Bootstraps the first admin sign-in. Run once:
 *   npm run seed:admin
 * Reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (defaults below) from env.
 */
import { adminClient } from "./_client";

const EMAIL = (process.env.SEED_ADMIN_EMAIL || "sidajayb@gmail.com").toLowerCase();
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || "WebberElectro@2026";
const NAME = process.env.SEED_ADMIN_NAME || "Administrator";

async function main() {
  const supa = adminClient();

  // Find or create the auth user.
  let userId: string | undefined;
  const { data: created, error } = await supa.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (created?.user) {
    userId = created.user.id;
    console.log(`Created auth user ${EMAIL}`);
  } else if (error && /already|registered|exists/i.test(error.message)) {
    // Look up existing user across pages.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await supa.auth.admin.listUsers({ page, perPage: 200 });
      userId = data?.users.find((u) => u.email?.toLowerCase() === EMAIL)?.id;
      if (!data || data.users.length < 200) break;
    }
    console.log(`Auth user ${EMAIL} already exists`);
  } else {
    throw error;
  }
  if (!userId) throw new Error("Could not resolve admin user id.");

  // Upsert the admin profile.
  const { error: pErr } = await supa
    .from("profiles")
    .upsert({ id: userId, full_name: NAME, role: "admin", is_active: true }, { onConflict: "id" });
  if (pErr) throw pErr;

  console.log(`\n✅ Admin ready.\n   Email:    ${EMAIL}\n   Password: ${PASSWORD}\n   (change the password after first sign-in)\n`);
}

main().catch((e) => {
  console.error("seed-admin failed:", e.message ?? e);
  process.exit(1);
});

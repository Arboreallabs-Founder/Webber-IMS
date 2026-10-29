// Applies every migration file not yet in supabase_migrations.schema_migrations,
// in timestamp order, one transaction per file (like `supabase db push`), and
// records each one. Stops at the first error — that file is rolled back.
//
//   node supabase/scripts/apply_pending_migrations.mjs          # list only
//   node supabase/scripts/apply_pending_migrations.mjs --go     # apply
// Uses DATABASE_URL from .env.local.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const go = process.argv.includes("--go");
const dir = "supabase/migrations";

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const applied = new Set((await c.query(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version));
const pending = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().filter((f) => !applied.has(f.split("_")[0]));

console.log(`${pending.length} pending:`);
for (const f of pending) console.log(`  ${f}`);
if (!go) { await c.end(); process.exit(0); }

for (const f of pending) {
  const version = f.split("_")[0];
  const name = f.slice(version.length + 1, -4);
  const sql = readFileSync(`${dir}/${f}`, "utf8");
  try {
    await c.query("begin");
    await c.query(sql);
    await c.query(`insert into supabase_migrations.schema_migrations(version, name, statements) values ($1, $2, $3)`, [version, name, [sql]]);
    await c.query("commit");
    console.log(`applied  ${f}`);
  } catch (e) {
    await c.query("rollback").catch(() => {});
    console.error(`FAILED   ${f}\n  ${e.message}\nStopped. Nothing from this file was applied.`);
    await c.end();
    process.exit(1);
  }
}
await c.end();
console.log("done");

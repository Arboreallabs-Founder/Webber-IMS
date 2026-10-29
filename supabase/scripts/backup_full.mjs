// READ-ONLY full backup of the public schema before a schema change:
//   * every table's rows, as JSON (one file per table)
//   * every function's, view's and trigger's current definition, every RLS
//     policy, enum values and column defaults — enough to put any database
//     object back exactly as it was
//   * the supabase_migrations history
//
//   node supabase/scripts/backup_full.mjs <out-dir>
// Uses DATABASE_URL from .env.local.
import pg from "pg";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const outDir = process.argv[2];
if (!outDir) { console.error("usage: node backup_full.mjs <out-dir>"); process.exit(1); }
mkdirSync(join(outDir, "tables"), { recursive: true });

const c = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("set default_transaction_read_only = on");
const q = async (s) => (await c.query(s)).rows;

const tables = await q(`select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
let total = 0;
for (const { table_name: t } of tables) {
  const rows = await q(`select * from public."${t}"`);
  writeFileSync(join(outDir, "tables", `${t}.json`), JSON.stringify(rows, null, 1));
  total += rows.length;
}
console.log(`tables: ${tables.length}, rows: ${total}`);

const functions = await q(`select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1`);
const views = await q(`select viewname as name, definition from pg_views where schemaname = 'public' order by 1`);
const triggers = await q(`select c.relname as table_name, t.tgname as name, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal order by 1, 2`);
const policies = await q(`select * from pg_policies where schemaname = 'public' order by tablename, policyname`);
const enums = await q(`select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by 1`);
const columns = await q(`select table_name, column_name, data_type, column_default, is_nullable
  from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`);
const migrations = await q(`select version, name from supabase_migrations.schema_migrations order by version`);

for (const [name, data] of Object.entries({ functions, views, triggers, policies, enums, columns, migrations })) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(data, null, 1));
  console.log(`${name}: ${data.length}`);
}
await c.end();

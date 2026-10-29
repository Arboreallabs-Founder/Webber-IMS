-- New 'viewer' role: view-only demo/audit accounts. A brand-new enum value
-- is automatically excluded from every existing RLS write policy (every
-- _mod/_ins/_upd/_del policy in this schema is an explicit role allowlist,
-- never a blanket "any authenticated"), so this migration on its own grants
-- zero write access anywhere. See 0097 for the RPC-level gap it surfaced.
alter type public.role add value 'viewer';

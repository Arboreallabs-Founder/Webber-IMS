-- New 'accounts' role (shown as "Accounts (Viewer)"): read-only like a Viewer,
-- but sees prices and costs on screen and in downloaded reports. A new enum
-- value is excluded from every existing RLS write policy (each is an explicit
-- role allowlist), so it can read but never create or change anything. Prices
-- are gated in the app (FINANCE_ROLES), which now includes 'accounts'.
alter type public.role add value if not exists 'accounts';

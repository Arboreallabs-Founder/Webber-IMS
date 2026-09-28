-- ============================================================
-- 0103 — Internal Consumption: reuses the projects table (customer_id
-- is already nullable) instead of a new entity, since it needs every
-- bit of the existing line-items -> BOM -> shortfall machinery. Adds
-- what's specific to it: a discriminator flag, and department/reason
-- in place of a customer.
-- ============================================================

alter table public.projects add column is_internal boolean not null default false;
alter table public.projects add column department text;
alter table public.projects add column consumption_reason text;

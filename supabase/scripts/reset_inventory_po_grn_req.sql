-- ============================================================
-- ONE-OFF RESET — NOT a migration. Run by hand in the Supabase SQL editor.
--
-- DELETES: all inventory (lots, stock movements, MPN breakdowns), all
-- purchase orders, all GRNs (+ IRNs, MRINs), all requisitions, all job-work
-- orders, all site purchases, all internal-consumption entries, and the
-- signatures/notifications that pointed at them. Restarts document
-- numbering at 0001.
--
-- KEEPS: components master (+ MPNs, alternatives, vendor tags), vendors,
-- customers, products, BOM templates, inspection templates, users,
-- signature images, approval rights, customer projects and their BOMs,
-- and the audit log (which will record these deletions).
--
-- HOW TO RUN
--   0. Take a backup first: Supabase → Database → Backups.
--   1. Run PART 1 alone. It only counts — nothing changes.
--   2. Check the counts are what you expect.
--   3. Run PART 2 alone. It's one transaction: if anything fails, NOTHING
--      is deleted. At the end it prints what's left (all should be 0).
-- ============================================================


-- ============================================================
-- PART 1 — PREVIEW (read-only). Run this first.
-- ============================================================
select 'inventory lots'            as what, count(*) from public.inventory_lots
union all select 'stock movements',          count(*) from public.stock_movements
union all select 'lot MPN breakdown rows',   count(*) from public.inventory_lot_mpns
union all select 'purchase orders',          count(*) from public.purchase_orders
union all select 'PO lines',                 count(*) from public.po_lines
union all select 'GRNs',                     count(*) from public.grns
union all select 'GRN lines',                count(*) from public.grn_lines
union all select 'IRNs',                     count(*) from public.irns
union all select 'requisitions',             count(*) from public.requisitions
union all select 'requisition lines',        count(*) from public.requisition_lines
union all select 'job-work orders',          count(*) from public.job_work_orders
union all select 'site purchases',           count(*) from public.site_purchases
union all select 'internal consumptions',    count(*) from public.projects where is_internal
union all select 'PO/GRN/JW signatures',     count(*) from public.document_signatures where document_type in ('po', 'grn', 'job_work')
union all select 'notifications to remove',  count(*) from public.notifications
  where link_path ~ '^/(purchase-orders|grn|requisitions|inventory|job-work|internal-consumption)(/|$)'
     or project_id in (select id from public.projects where is_internal)
-- these STAY — shown so you can confirm they're untouched afterwards
union all select '[kept] components',        count(*) from public.components
union all select '[kept] customer projects', count(*) from public.projects where not is_internal
union all select '[kept] vendors',           count(*) from public.vendors;


-- ============================================================
-- PART 2 — DELETE. Run on its own, after checking PART 1.
-- Order matters: each step removes what still points at the next.
-- ============================================================
begin;

-- Site purchases point at lots, BOM lines and projects.
delete from public.site_purchases;

-- IRNs point at lots, GRN lines, PO lines and job-work lines
-- (irn_answers go with them).
delete from public.irns;

-- Break the GRN <-> lot and GRN <-> job-work links so either side can go.
update public.grn_lines set target_lot_id = null, jw_line_id = null
 where target_lot_id is not null or jw_line_id is not null;

-- Job-work orders (job_work_lines go with them) point at lots.
delete from public.job_work_orders;

-- Stock: movements first, then the lots (MPN breakdowns go with the lots).
delete from public.stock_movements;
delete from public.inventory_lots;

-- GRNs (grn_lines, MRINs and their checks/lines/answers go with them).
delete from public.grns;

-- Purchase orders (po_lines go with them).
delete from public.purchase_orders;

-- Requisitions (requisition_lines go with them).
delete from public.requisitions;

-- Notifications about the deleted documents / internal consumptions
-- (notification_reads go with them). Must run before the projects below.
delete from public.notifications
 where link_path ~ '^/(purchase-orders|grn|requisitions|inventory|job-work|internal-consumption)(/|$)'
    or project_id in (select id from public.projects where is_internal);

-- Internal consumptions (their BOMs, line items, documents and activities
-- go with them).
delete from public.projects where is_internal;

-- Signatures on the deleted POs / GRNs / job-work orders.
delete from public.document_signatures where document_type in ('po', 'grn', 'job_work');

-- Restart numbering: next documents are PO/…/0001, GRN/…/0001, REQ/…/0001 …
alter sequence if exists public.seq_po_no            restart with 1;
alter sequence if exists public.seq_grn_no           restart with 1;
alter sequence if exists public.seq_req_no           restart with 1;
alter sequence if exists public.seq_irn_no           restart with 1;
alter sequence if exists public.seq_mrin_no          restart with 1;
alter sequence if exists public.seq_jw_no            restart with 1;
alter sequence if exists public.seq_jw_grn_no        restart with 1;
alter sequence if exists public.seq_site_purchase_no restart with 1;

-- What's left — every deleted row count should be 0; [kept] rows unchanged.
select 'inventory lots'            as what, count(*) from public.inventory_lots
union all select 'stock movements',          count(*) from public.stock_movements
union all select 'purchase orders',          count(*) from public.purchase_orders
union all select 'GRNs',                     count(*) from public.grns
union all select 'IRNs',                     count(*) from public.irns
union all select 'requisitions',             count(*) from public.requisitions
union all select 'job-work orders',          count(*) from public.job_work_orders
union all select 'site purchases',           count(*) from public.site_purchases
union all select 'internal consumptions',    count(*) from public.projects where is_internal
union all select '[kept] components',        count(*) from public.components
union all select '[kept] customer projects', count(*) from public.projects where not is_internal
union all select '[kept] vendors',           count(*) from public.vendors;

commit;

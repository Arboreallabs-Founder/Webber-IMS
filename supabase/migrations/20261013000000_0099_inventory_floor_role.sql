-- New 'floor' role (shown as "Inventory Floor"): gate/stores staff who receive
-- goods (PO + job-work GRNs) and work requisitions, and must NEVER see a price
-- or cost. A new enum value is excluded from every existing RLS write policy
-- (each is an explicit role allowlist), so on its own this grants no writes;
-- 0100 opens exactly the receiving/requisition paths and nothing else.
alter type public.role add value 'floor';

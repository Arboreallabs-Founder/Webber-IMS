-- ============================================================
-- 0097 — recompute_lot_on_hand() still had the pre-rename 'available'
-- enum label baked into its body. Migration 0031b renamed lot_status
-- 'available' -> 'open' but this function (created in 0008, before
-- the rename) was never recreated, so every stock_movements write —
-- e.g. every GRN receipt — failed with:
--   invalid input value for enum lot_status: "available"
-- ============================================================
create or replace function public.recompute_lot_on_hand()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_lot uuid; v_sum numeric;
begin
  v_lot := coalesce(new.lot_id, old.lot_id);
  if v_lot is null then return coalesce(new, old); end if;
  select coalesce(sum(qty),0) into v_sum from public.stock_movements where lot_id = v_lot;
  update public.inventory_lots
     set qty_on_hand = v_sum,
         status = case when v_sum <= 0 then 'consumed'::public.lot_status
                       when status = 'consumed' and v_sum > 0 then 'open'::public.lot_status
                       else status end
   where id = v_lot;
  return coalesce(new, old);
end; $$;

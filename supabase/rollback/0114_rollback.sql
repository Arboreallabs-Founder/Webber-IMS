-- ============================================================
-- ROLLBACK for 0114_reserved_slices_and_auto_release.
-- NOT a migration — do not move this into supabase/migrations/.
-- Run it by hand (Supabase SQL editor) only if 0114 must be undone.
--
-- Restores, byte-for-byte from the migration files 0114 replaced:
--   v_component_on_hand (0079), v_project_consumption (0069),
--   v_bom_variance + v_missing_po (0084), issue_requisition (0068),
--   grn_line_after_insert (0105)
-- and drops the functions 0114 added.
--
-- DATA IS KEPT. Reserved parts ("slices") created while 0114 was live stay
-- as separate reserved lots, exactly like blocks made before 0114 — i.e.
-- the old problem comes back for them: they can't be found by scanning the
-- box. Before running this, consider unissuing them (Inventory → component
-- → Unissue) so their stock goes back into their boxes while that still
-- works. To list them:
--   select l.lot_code, b.lot_code as box, l.qty_on_hand, p.project_no
--     from inventory_lots l
--     join inventory_lots b on b.id = l.source_lot_id
--     left join projects p on p.id = l.project_id
--    where l.status = 'issued' and l.qty_on_hand > 0;
--
-- The source_lot_id column is left in place (nothing old reads it, and it
-- keeps the slice -> box link if 0114 is re-applied). Drop it at the very
-- end only if you're sure: alter table public.inventory_lots drop column source_lot_id;
-- ============================================================

begin;

-- ---- functions added by 0114 ----
drop function if exists public.consume_from_lot(uuid, numeric, uuid, uuid, text);
drop function if exists public.release_blocked_lot(uuid, numeric);
drop function if exists public.recheck_project_reservations(uuid);

-- ---- issue_requisition, as of 0068 ----
-- ============================================================
-- 0068 — issue_requisition's partial-split branch (blocking part of a
-- lot for a project) used to edit inventory_lots.qty_on_hand/qty_initial
-- directly, with no matching stock_movements row. Because
-- recompute_lot_on_hand() always recomputes qty_on_hand as
-- SUM(stock_movements.qty), the very next unrelated movement logged
-- against either the original or split-off lot silently overwrote
-- qty_on_hand from an incomplete ledger, erasing the block (or driving
-- qty_on_hand negative). Fix: record the split as two real ledger
-- movements ('transfer', reference_type='requisition_block' — kept
-- distinct from 'requisition' so it doesn't surface in the unrelated
-- "Consumed in this requisition" panel, which filters reference_type=
-- 'requisition' with no movement_type filter) and let the existing
-- trigger derive qty_on_hand, instead of setting it directly.
-- ============================================================

create or replace function public.issue_requisition(p_req_id uuid, p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_req         RECORD;
  v_line        RECORD;
  v_lot         RECORD;
  v_remaining   numeric;
  v_take        numeric;
  v_new_code    text;
  v_new_lot_id  uuid;
  v_short       jsonb := '[]'::jsonb;
  v_any_covered boolean := false;
  v_all_covered boolean := true;
BEGIN
  SELECT * INTO v_req FROM public.requisitions WHERE id = p_req_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Requisition not found');
  END IF;
  IF v_req.status NOT IN ('open', 'partially_issued') THEN
    RETURN jsonb_build_object('error', 'Only open or partially-issued requisitions can be issued');
  END IF;

  FOR v_line IN
    SELECT rl.component_id, rl.qty,
           c.component_no || ' — ' || c.name AS label
    FROM   public.requisition_lines rl
    JOIN   public.components c ON c.id = rl.component_id
    WHERE  rl.requisition_id = p_req_id
  LOOP
    -- net off whatever's already reserved (issued) for this project from a prior run
    v_remaining := v_line.qty - coalesce((
      SELECT sum(qty_on_hand) FROM public.inventory_lots
      WHERE component_id = v_line.component_id AND status = 'issued' AND project_id = v_req.project_id
    ), 0);
    IF v_remaining <= 0 THEN
      v_any_covered := true;
      CONTINUE;
    END IF;

    -- Walk open lots FIFO — only untagged stock or stock already earmarked for
    -- THIS project; never grab an open lot tagged to a different project.
    FOR v_lot IN
      SELECT id, qty_on_hand, vendor_id, unit_cost, location, is_serialized
      FROM   public.inventory_lots
      WHERE  component_id = v_line.component_id
        AND  status = 'open'
        AND  qty_on_hand > 0
        AND  (project_id IS NULL OR project_id = v_req.project_id)
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_lot.qty_on_hand, v_remaining);

      IF v_take >= v_lot.qty_on_hand THEN
        UPDATE public.inventory_lots
        SET status = 'issued', project_id = v_req.project_id
        WHERE id = v_lot.id;
      ELSE
        UPDATE public.inventory_lots
        SET qty_initial = qty_initial - v_take
        WHERE id = v_lot.id;

        v_new_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-'
                   || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
        INSERT INTO public.inventory_lots(
          lot_code, component_id, vendor_id, project_id,
          qty_on_hand, qty_initial, unit_cost, location,
          is_serialized, status, created_by)
        SELECT v_new_code, v_line.component_id, vendor_id, v_req.project_id,
               0, v_take, unit_cost, location,
               is_serialized, 'issued', p_user_id
        FROM   public.inventory_lots WHERE id = v_lot.id
        RETURNING id INTO v_new_lot_id;

        INSERT INTO public.stock_movements(
          lot_id, component_id, movement_type, qty, project_id,
          reference_type, reference_id, performed_by, created_by)
        VALUES
          (v_lot.id, v_line.component_id, 'transfer', -v_take, v_req.project_id,
           'requisition_block', p_req_id, p_user_id, p_user_id),
          (v_new_lot_id, v_line.component_id, 'transfer', v_take, v_req.project_id,
           'requisition_block', p_req_id, p_user_id, p_user_id);
      END IF;

      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining > 0 THEN
      v_all_covered := false;
      v_short := v_short || jsonb_build_array(jsonb_build_object('label', v_line.label, 'short_qty', v_remaining));
    ELSE
      v_any_covered := true;
    END IF;
  END LOOP;

  UPDATE public.requisitions
     SET status = CASE
       WHEN v_all_covered THEN 'issued'
       WHEN v_any_covered THEN 'partially_issued'
       ELSE v_req.status
     END
   WHERE id = p_req_id;

  RETURN jsonb_build_object('ok', true, 'fully_covered', v_all_covered, 'short', v_short);
END;
$function$;


-- 0068's issue_requisition needs no helpers, so the internal ones can go now.
drop function if exists public._auto_release(uuid, uuid, uuid);
drop function if exists public._release_lot(uuid, numeric, uuid);
drop function if exists public._make_slice(uuid, numeric, public.lot_status, uuid, uuid, text, uuid);
drop function if exists public._move_mpn(uuid, uuid, numeric, uuid);

-- ---- grn_line_after_insert, as of 0105 ----
create or replace function public.grn_line_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_track  public.tracking_mode;
  v_is_ser boolean;
  v_is_jw  boolean;
  v_stage  public.jw_stage;
  v_vendor uuid;
  v_lot    uuid;
  v_code   text;
  v_status public.lot_status;
  v_n      int;
  i        int;
  v_piece_qty  numeric;
  v_jwline     record;
  v_last       uuid;
  v_total_sent numeric;
  v_total_ret  numeric;
begin
  select tracking_mode, is_serialized, is_job_work
    into v_track, v_is_ser, v_is_jw
    from public.components where id = NEW.component_id;
  v_stage  := case when coalesce(v_is_jw, false) then 'raw'::public.jw_stage else null end;
  v_vendor := (select vendor_id from public.grns where id = NEW.grn_id);
  v_status := case when NEW.project_id is not null then 'issued'::public.lot_status else 'open'::public.lot_status end;

  -- (0) Job-work completed-goods receipt: one or more lots produced from a
  -- specific job_work_lines row, parented to the raw lot that was consumed.
  if NEW.jw_line_id is not null then
    select * into v_jwline from public.job_work_lines where id = NEW.jw_line_id;

    if v_track = 'item' and NEW.qty_received = floor(NEW.qty_received)
       and NEW.qty_received > 0 and NEW.qty_received <= 1000 then
      v_n := NEW.qty_received::int;
    else
      v_n := 1;
    end if;

    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      v_piece_qty := case when v_n > 1 then 1 else NEW.qty_received end;
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id, parent_lot_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
        container_no, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id, v_jwline.raw_lot_id,
        0, v_piece_qty, NEW.unit_cost,
        case when v_track = 'item' then true else coalesce(v_is_ser, false) end,
        v_status, 'completed'::public.jw_stage, NEW.location,
        case when v_track = 'box' then v_code else null end, NEW.created_by)
      returning id into v_lot;
      if NEW.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, NEW.mpn_id, v_piece_qty, NEW.created_by);
      end if;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, NEW.component_id, 'receipt', v_piece_qty, NEW.project_id,
        'grn', NEW.id, NEW.created_by, NEW.created_by);
      v_last := v_lot;
    end loop;

    update public.job_work_lines
       set qty_returned = coalesce(qty_returned, 0) + NEW.qty_received,
           completed_lot_id = v_last
     where id = NEW.jw_line_id;

    select coalesce(sum(qty_sent), 0), coalesce(sum(qty_returned), 0)
      into v_total_sent, v_total_ret
      from public.job_work_lines where jw_order_id = v_jwline.jw_order_id;
    update public.job_work_orders
       set status = case when v_total_ret >= v_total_sent then 'received' else 'partial' end
     where id = v_jwline.jw_order_id;

    return NEW;
  end if;

  -- (a) Add-to-existing-box: no new lot, just a receipt movement into the
  -- chosen box. Unlike location (which a box only ever has one of), a box
  -- CAN genuinely hold more than one MPN — record/accumulate this receipt's
  -- MPN in the box's breakdown instead of leaving it untouched.
  if NEW.target_lot_id is not null then
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (NEW.target_lot_id, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
      'grn', NEW.id, NEW.created_by, NEW.created_by);
    if NEW.mpn_id is not null then
      insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
      values (NEW.target_lot_id, NEW.mpn_id, NEW.qty_received, NEW.created_by)
      on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
    end if;
    return NEW;
  end if;

  -- (b) Item tracking: one lot (one QR) per physical piece.
  if v_track = 'item' and NEW.qty_received = floor(NEW.qty_received)
     and NEW.qty_received > 0 and NEW.qty_received <= 1000 then
    v_n := NEW.qty_received::int;
    for i in 1..v_n loop
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
        0, 1, NEW.unit_cost, true, v_status, v_stage, NEW.location, NEW.created_by)
      returning id into v_lot;
      if NEW.mpn_id is not null then
        insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
        values (v_lot, NEW.mpn_id, 1, NEW.created_by);
      end if;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, NEW.component_id, 'receipt', 1, NEW.project_id,
        'grn', NEW.id, NEW.created_by, NEW.created_by);
    end loop;
    return NEW;
  end if;

  -- (c) Box / bulk (default): one lot for the whole receipt.
  v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.inventory_lots(
    lot_code, component_id, grn_line_id, vendor_id, project_id,
    qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location,
    container_no, created_by)
  values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
    0, NEW.qty_received, NEW.unit_cost, coalesce(v_is_ser, false), v_status, v_stage, NEW.location,
    case when v_track = 'box' then v_code else null end, NEW.created_by)
  returning id into v_lot;
  if NEW.mpn_id is not null then
    insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
    values (v_lot, NEW.mpn_id, NEW.qty_received, NEW.created_by);
  end if;
  insert into public.stock_movements(
    lot_id, component_id, movement_type, qty, project_id,
    reference_type, reference_id, performed_by, created_by)
  values (v_lot, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
    'grn', NEW.id, NEW.created_by, NEW.created_by);
  return NEW;
end; $$;


-- ---- views, as of 0079 / 0069 / 0084 ----
-- v_component_on_hand previously joined inventory_lots with "and l.status <> 'consumed'"
-- in the ON clause, so a component whose only lots were fully consumed produced zero
-- joined rows and vanished from the Inventory list entirely. Consumed lots always have
-- qty_on_hand = 0 (verified against production data), so joining unconditionally does
-- not change qty_on_hand/stock_value — it only lets has_stock_history distinguish
-- "purchased and fully consumed" (should still show, at qty 0) from "never purchased"
-- (should stay hidden).

create or replace view public.v_component_on_hand with (security_invoker = true) as
select c.id as component_id, c.component_no, c.name, c.uom,
       coalesce(sum(l.qty_on_hand), 0)                                       as qty_on_hand,
       coalesce(sum(l.qty_on_hand * coalesce(pl.rate, l.unit_cost)), 0)      as stock_value,
       count(l.id) filter (where l.status <> 'consumed')                    as lot_count,
       count(l.id) > 0                                                      as has_stock_history
from public.components c
left join public.inventory_lots l
       on l.component_id = c.id
left join public.grn_lines gl
       on gl.id = l.grn_line_id
left join public.po_lines pl
       on pl.id = gl.po_line_id and pl.approval_status = 'approved'
group by c.id, c.component_no, c.name, c.uom;

create or replace view public.v_component_on_hand_safe with (security_invoker = true) as
select component_id, component_no, name, uom, qty_on_hand, lot_count, has_stock_history
from public.v_component_on_hand;


-- Admin-only reversal of a consumption (`issue`) movement back to open stock.
-- Reversal is a compensating `return` movement on the same lot (never a
-- mutation/delete of the original — stock_movements is append-only), which
-- `recompute_lot_on_hand()` picks up automatically to restore qty_on_hand
-- and flip status back to 'open'. This migration:
--   1. Nets `return` reversals against `issue` consumption in
--      v_project_consumption, so the project's "Materials issued" panel and
--      cost cards correctly reflect a reversal (preserving the existing
--      approved-PO-rate valuation logic from migration 0062 unchanged).
--   2. Restricts inserting a `return` movement to admin only (defense in
--      depth alongside the app-layer check in `reverseConsumption`).

create or replace view public.v_project_consumption with (security_invoker = true) as
select
  m.project_id,
  m.component_id,
  sum(-m.qty) as consumed_qty,
  sum((-m.qty) * coalesce(pl.rate, l.unit_cost)) as consumption_value
from stock_movements m
join inventory_lots l on l.id = m.lot_id
left join grn_lines gl on gl.id = l.grn_line_id
left join po_lines pl on pl.id = gl.po_line_id and pl.approval_status = 'approved'::po_line_approval_status
where m.movement_type = any (array['issue'::movement_type, 'return'::movement_type])
  and m.project_id is not null
group by m.project_id, m.component_id;

-- ============================================================
-- 0084 — "Missing PO" / "BOM variance" stop flagging demand that
--         is already covered by consumption or on-hand stock.
--
-- v_bom_variance / v_missing_po compared BOM demand against PO lines
-- and receipts *tagged to the same project* only. Demand met another
-- way — consumed from general/untagged stock, a site purchase, or a
-- requisition drawing down open stock — left ordered_qty = 0, so the
-- Action Center kept nagging "no PO raised" even though the material
-- was physically on the job (and often already consumed). The
-- project's own Shortfall panel (v_project_shortfall) already nets
-- these off; this aligns the reconciliation views with it.
--
-- Rebuilt on top of the live definition (which already includes the
-- 20260818 "bom_variance_include_blocked_stock" change: cancelled PO
-- lines excluded from `ord`; project-reserved lots with no grn_line
-- counted in `rcv`). Adds three trailing columns to v_bom_variance
-- (CREATE OR REPLACE, so the dependent v_missing_po is untouched):
--   consumed_qty  — genuinely consumed for this project (issue
--                   movements, excluding job-work dispatch); mirrors
--                   project_shortfall()'s definition
--   on_hand_qty   — coverable stock: general/untagged lots + this
--                   project's own open lots (other projects' reserved
--                   stock excluded); mirrors project_shortfall()
--   uncovered_qty — greatest(required - ordered - consumed - on_hand, 0)
--                   = demand that genuinely still needs a PO
--
-- v_missing_po now filters on uncovered_qty > 0 (instead of
-- required_qty > received_qty) and exposes the three new columns.
--
-- NOTE: on_hand_qty is credited to every project needing the
-- component (a flat view can't run project_shortfall()'s working-pool
-- walk), so shared stock can be over-credited. That errs toward NOT
-- raising a false alarm, which is the intent; the project page's
-- recursive v_project_shortfall stays the precise source of truth.
-- ============================================================

create or replace view public.v_bom_variance with (security_invoker = true) as
with req as (
  select b.project_id, bl.component_id, sum(bl.required_qty) as required_qty
  from public.boms b
  join public.bom_lines bl on bl.bom_id = b.id
  where bl.component_id is not null
  group by b.project_id, bl.component_id
),
ord as (
  select pl.project_id, pl.component_id, sum(pl.qty_ordered) as ordered_qty
  from public.po_lines pl
  where pl.project_id is not null and pl.component_id is not null
    and pl.line_status <> 'cancelled'::po_line_status
  group by pl.project_id, pl.component_id
),
rcv as (
  select src.project_id, src.component_id, sum(src.qty) as received_qty
  from (
    select gl.project_id, gl.component_id, gl.qty_received as qty
    from public.grn_lines gl
    where gl.project_id is not null and gl.component_id is not null
    union all
    select l.project_id, l.component_id, l.qty_initial as qty
    from public.inventory_lots l
    where l.project_id is not null and l.component_id is not null
      and l.grn_line_id is null
      and l.status = any (array['issued'::lot_status, 'consumed'::lot_status])
  ) src
  group by src.project_id, src.component_id
),
csm as (
  select sm.project_id, sm.component_id, sum(-sm.qty) as consumed_qty
  from public.stock_movements sm
  where sm.movement_type = 'issue' and sm.project_id is not null and sm.component_id is not null
    and sm.reference_type is distinct from 'job_work'
  group by sm.project_id, sm.component_id
),
oh as (
  select il.project_id, il.component_id, sum(il.qty_on_hand) as qty
  from public.inventory_lots il
  where il.status <> 'consumed' and il.qty_on_hand > 0 and il.component_id is not null
  group by il.project_id, il.component_id
),
keys as (
  select project_id, component_id from req
  union select project_id, component_id from ord
  union select project_id, component_id from rcv
  union select project_id, component_id from csm
),
ohk as (
  select k.project_id, k.component_id, coalesce(sum(o.qty), 0) as on_hand_qty
  from keys k
  left join oh o on o.component_id = k.component_id
                and (o.project_id is null or o.project_id = k.project_id)
  group by k.project_id, k.component_id
)
select k.project_id,
       k.component_id,
       coalesce(req.required_qty, 0) as required_qty,
       coalesce(ord.ordered_qty, 0)  as ordered_qty,
       coalesce(rcv.received_qty, 0)  as received_qty,
       coalesce(req.required_qty, 0) - coalesce(ord.ordered_qty, 0) as order_gap,     -- >0 = under-ordered
       coalesce(ord.ordered_qty, 0)  - coalesce(rcv.received_qty, 0) as receive_gap,  -- >0 = awaiting receipt
       coalesce(csm.consumed_qty, 0) as consumed_qty,
       coalesce(ohk.on_hand_qty, 0)  as on_hand_qty,
       greatest(
         coalesce(req.required_qty, 0)
         - coalesce(ord.ordered_qty, 0)
         - coalesce(csm.consumed_qty, 0)
         - coalesce(ohk.on_hand_qty, 0),
       0) as uncovered_qty                                                            -- >0 = genuinely still needs a PO
from keys k
left join req on req.project_id = k.project_id and req.component_id = k.component_id
left join ord on ord.project_id = k.project_id and ord.component_id = k.component_id
left join rcv on rcv.project_id = k.project_id and rcv.component_id = k.component_id
left join csm on csm.project_id = k.project_id and csm.component_id = k.component_id
left join ohk on ohk.project_id = k.project_id and ohk.component_id = k.component_id;

grant select on public.v_bom_variance to authenticated;

-- ---- missing PO: BOM demand with nothing ordered AND not covered by stock ----
create or replace view public.v_missing_po with (security_invoker = true) as
select bv.project_id, bv.component_id, c.component_no, c.name as component_name,
       bv.required_qty, bv.ordered_qty, bv.received_qty, bv.order_gap,
       bv.consumed_qty, bv.on_hand_qty, bv.uncovered_qty
from public.v_bom_variance bv
left join public.components c on c.id = bv.component_id
where bv.ordered_qty = 0 and bv.uncovered_qty > 0;

grant select on public.v_missing_po to authenticated;


commit;

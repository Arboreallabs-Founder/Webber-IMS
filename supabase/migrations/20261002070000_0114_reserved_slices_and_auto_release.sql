-- ============================================================
-- 0114 — Reserved slices, scan-the-box consumption, auto-release.
--
-- Problem: blocking PART of a box (issue_requisition's partial branch)
-- split the reserved qty into a brand-new lot with no sticker and no
-- link back to the box. The floor team only ever scans the box sticker,
-- so that reserved stock could never be found or consumed. Reservations
-- a project no longer needed (e.g. it drew from a different box) also
-- stayed locked until someone noticed and clicked Unissue.
--
-- Fix: a reserved part ("slice") now remembers the lot it physically
-- sits in (source_lot_id, always one level deep). Scanning the box sees
-- the box's open stock + any slice reserved for the scanning project.
-- consume_from_lot() takes this project's reservation first, then open
-- stock, never another project's — then frees whatever the project no
-- longer needs back into the box it came from.
--
-- "Still needed" = greatest(approved BOM qty, approved PO qty) minus
-- what the project has already consumed. Checked after every
-- consumption and on BOM approval. Never for job-work components, and
-- never for a component with neither a BOM line nor a PO line.
--
-- Built on this repo's latest versions of everything it replaces:
--   issue_requisition      <- 0068
--   grn_line_after_insert  <- 0105 (MPN breakdown, location, job work)
--   v_component_on_hand    <- 0079
--   v_project_consumption  <- 0069
--   v_bom_variance         <- 0084
-- Requires 0113 (req_status 'issued' / 'partially_issued').
-- ============================================================

-- ---- 1. Slice -> box link ----
alter table public.inventory_lots
  add column if not exists source_lot_id uuid references public.inventory_lots(id);
create index if not exists idx_inventory_lots_source_lot on public.inventory_lots(source_lot_id);

-- Backfill splits made by 0068's partial branch: it wrote a -qty transfer
-- on the box and a +qty transfer on the new lot in one statement, so both
-- rows share reference_id, component, qty and performed_at. (Most likely
-- none exist — until 0113 every successful block failed on the enum.)
update public.inventory_lots l
   set source_lot_id = src.lot_id
  from public.stock_movements plus
  join public.stock_movements src
    on src.reference_type = 'requisition_block'
   and src.reference_id   = plus.reference_id
   and src.component_id   = plus.component_id
   and src.qty            = -plus.qty
   and src.performed_at   = plus.performed_at
   and src.lot_id        <> plus.lot_id
 where plus.lot_id = l.id
   and plus.reference_type = 'requisition_block'
   and plus.movement_type  = 'transfer'
   and plus.qty > 0
   and l.source_lot_id is null
   and l.grn_line_id is null;

-- ---- 2. Internal helpers ----

-- Move (or, with p_to null, just use up) p_qty of a lot's MPN breakdown,
-- last-in-first-out — the MPN most recently added to the box goes first.
-- Best-effort: a lot with no breakdown has nothing to move.
create or replace function public._move_mpn(p_from uuid, p_to uuid, p_qty numeric, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_left numeric := p_qty;
  v_take numeric;
begin
  for r in
    select id, mpn_id, qty from public.inventory_lot_mpns
     where lot_id = p_from and qty > 0
     order by created_at desc, id
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    if v_take >= r.qty then
      delete from public.inventory_lot_mpns where id = r.id;
    else
      update public.inventory_lot_mpns set qty = qty - v_take where id = r.id;
    end if;
    if p_to is not null then
      insert into public.inventory_lot_mpns(lot_id, mpn_id, qty, created_by)
      values (p_to, r.mpn_id, v_take, p_user)
      on conflict (lot_id, mpn_id) do update set qty = public.inventory_lot_mpns.qty + excluded.qty;
    end if;
    v_left := v_left - v_take;
  end loop;
end; $$;

-- Carve p_qty out of a lot into a new slice that sits in the same box.
-- Two 'transfer' movements keep the ledger the source of truth (the
-- recompute trigger derives both lots' qty_on_hand). No container_no, so
-- a slice never shows up as a box in the GRN add-to-box list; no
-- grn_line_id, so the GRN page never offers it a sticker.
create or replace function public._make_slice(
  p_from uuid, p_qty numeric, p_status public.lot_status, p_project uuid,
  p_user uuid, p_ref_type text, p_ref_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_from record;
  v_id   uuid;
  v_code text;
begin
  select * into v_from from public.inventory_lots where id = p_from;
  if not found then raise exception 'Lot not found.'; end if;
  if p_qty <= 0 or v_from.qty_on_hand < p_qty then
    raise exception 'Lot % has only % (need %).', v_from.lot_code, v_from.qty_on_hand, p_qty;
  end if;

  v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.inventory_lots(
    lot_code, component_id, vendor_id, project_id, source_lot_id,
    qty_on_hand, qty_initial, unit_cost, location, is_serialized, status, jw_stage,
    piece_length, piece_width, piece_weight, created_by)
  values (
    v_code, v_from.component_id, v_from.vendor_id, p_project, coalesce(v_from.source_lot_id, v_from.id),
    0, p_qty, v_from.unit_cost, v_from.location, v_from.is_serialized, p_status, v_from.jw_stage,
    v_from.piece_length, v_from.piece_width, v_from.piece_weight, p_user)
  returning id into v_id;

  insert into public.stock_movements(
    lot_id, component_id, movement_type, qty, project_id,
    reference_type, reference_id, performed_by, created_by)
  values
    (p_from, v_from.component_id, 'transfer', -p_qty, p_project, p_ref_type, p_ref_id, p_user, p_user),
    (v_id,   v_from.component_id, 'transfer',  p_qty, p_project, p_ref_type, p_ref_id, p_user, p_user);

  perform public._move_mpn(p_from, v_id, p_qty, p_user);
  return v_id;
end; $$;

-- Give back up to p_qty (null = all) of a reserved lot. Returns qty freed.
--   slice, box is free stock -> qty merges back into the box; an emptied
--                               slice nothing was ever used from is deleted
--   slice, box reserved      -> the slice (or the freed part of it) turns
--                               open in place, so it isn't handed to the
--                               box's project
--   whole lot, all of it     -> lot goes open
--   whole lot, part of it    -> the sticker lot goes open and the part still
--                               reserved becomes a slice inside it, so the
--                               sticker always points at free stock
create or replace function public._release_lot(p_lot uuid, p_qty numeric, p_user uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_lot record;
  v_src record;
  v_qty numeric;
begin
  select * into v_lot from public.inventory_lots where id = p_lot for update;
  if not found or v_lot.status <> 'issued' or v_lot.qty_on_hand <= 0 then return 0; end if;
  v_qty := least(coalesce(p_qty, v_lot.qty_on_hand), v_lot.qty_on_hand);
  if v_qty <= 0 then return 0; end if;

  if v_lot.source_lot_id is not null then
    select * into v_src from public.inventory_lots where id = v_lot.source_lot_id for update;

    if v_src.status <> 'issued' and v_src.project_id is null then
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values
        (v_lot.id, v_lot.component_id, 'transfer', -v_qty, v_lot.project_id, 'reservation_release', v_lot.id, p_user, p_user),
        (v_src.id, v_lot.component_id, 'transfer',  v_qty, v_lot.project_id, 'reservation_release', v_lot.id, p_user, p_user);
      perform public._move_mpn(v_lot.id, v_src.id, v_qty, p_user);

      -- Emptied and never drawn from: nothing to keep. A slice that WAS
      -- drawn from stays (as 'consumed') — deleting it would erase the
      -- project's consumption and cost.
      if v_qty >= v_lot.qty_on_hand and not exists (
        select 1 from public.stock_movements
         where lot_id = v_lot.id and movement_type in ('issue', 'return')
      ) then
        begin
          delete from public.stock_movements where lot_id = v_lot.id;
          delete from public.inventory_lots where id = v_lot.id;
        exception when foreign_key_violation then
          null; -- something references it; leave it as an empty, consumed slice
        end;
      end if;
    elsif v_qty >= v_lot.qty_on_hand then
      update public.inventory_lots set status = 'open', project_id = null where id = v_lot.id;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot.id, v_lot.component_id, 'transfer', 0, v_lot.project_id, 'reservation_release', v_lot.id, p_user, p_user);
    else
      perform public._make_slice(v_lot.id, v_qty, 'open', null, p_user, 'reservation_release', v_lot.id);
    end if;
  else
    if v_qty < v_lot.qty_on_hand then
      perform public._make_slice(v_lot.id, v_lot.qty_on_hand - v_qty, 'issued', v_lot.project_id,
                                 p_user, 'reservation_release', v_lot.id);
    end if;
    update public.inventory_lots set status = 'open', project_id = null where id = v_lot.id;
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (v_lot.id, v_lot.component_id, 'transfer', 0, v_lot.project_id, 'reservation_release', v_lot.id, p_user, p_user);
  end if;

  return v_qty;
end; $$;

-- Free whatever a project has reserved of one component beyond what it
-- still needs, oldest reservation first. Returns qty freed.
create or replace function public._auto_release(p_project uuid, p_component uuid, p_user uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_jw       boolean;
  v_bom      numeric;
  v_has_bom  boolean;
  v_po       numeric;
  v_has_po   boolean;
  v_consumed numeric;
  v_needed   numeric;
  v_reserved numeric;
  v_excess   numeric;
  v_freed    numeric := 0;
  v_r        numeric;
  r          record;
begin
  if p_project is null or p_component is null then return 0; end if;

  -- Job-work finished parts come back reserved after the raw stock was
  -- already counted as used, so the arithmetic below would wrongly free them.
  select is_job_work into v_jw from public.components where id = p_component;
  if coalesce(v_jw, false) then return 0; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_project::text || ':' || p_component::text, 0));

  select coalesce(sum(bl.required_qty), 0), count(*) > 0
    into v_bom, v_has_bom
    from public.boms b
    join public.bom_lines bl on bl.bom_id = b.id
   where b.project_id = p_project and b.status = 'approved' and bl.component_id = p_component;

  select coalesce(sum(pl.qty_ordered), 0), count(*) > 0
    into v_po, v_has_po
    from public.po_lines pl
    join public.purchase_orders po on po.id = pl.po_id
   where pl.project_id = p_project and pl.component_id = p_component
     and pl.approval_status = 'approved'
     and pl.line_status <> 'cancelled'
     and po.status not in ('cancelled', 'superseded');

  -- Nothing to compare against: leave it for a manual Unissue.
  if not v_has_bom and not v_has_po then return 0; end if;

  select coalesce(sum(-qty), 0) into v_consumed
    from public.stock_movements
   where project_id = p_project and component_id = p_component
     and movement_type in ('issue', 'return')
     and reference_type is distinct from 'job_work';

  v_needed := greatest(greatest(v_bom, v_po) - v_consumed, 0);

  select coalesce(sum(qty_on_hand), 0) into v_reserved
    from public.inventory_lots
   where project_id = p_project and component_id = p_component
     and status = 'issued' and qty_on_hand > 0;

  v_excess := v_reserved - v_needed;
  if v_excess <= 0 then return 0; end if;

  for r in
    select id, qty_on_hand from public.inventory_lots
     where project_id = p_project and component_id = p_component
       and status = 'issued' and qty_on_hand > 0
     order by created_at, id
  loop
    exit when v_excess <= 0;
    v_r := public._release_lot(r.id, least(v_excess, r.qty_on_hand), p_user);
    v_excess := v_excess - v_r;
    v_freed  := v_freed + v_r;
  end loop;

  return v_freed;
end; $$;

-- ---- 3. RPCs ----

-- Scan-to-consume. p_lot is whatever was scanned (normally the box
-- sticker). Draws this project's reservation in that box first, then the
-- box's open stock, never another project's; then auto-releases.
create or replace function public.consume_from_lot(
  p_lot uuid, p_qty numeric, p_project uuid default null,
  p_requisition uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_role      public.role := public.auth_role();
  v_scanned   record;
  v_box       uuid;
  v_reserved  numeric;
  v_open      numeric;
  v_left      numeric;
  v_take      numeric;
  v_from_res  numeric := 0;
  v_from_open numeric := 0;
  v_freed     numeric := 0;
  v_ref       text;
  r           record;
begin
  if v_role is null then raise exception 'Not authorized.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity to consume.'; end if;

  if p_project is not null then
    if v_role not in ('admin', 'team_lead', 'team_member', 'inventory_admin') then
      raise exception 'Not authorized.';
    end if;
  else
    -- Untagged (stock) consumption — admin-only, and a reason is required.
    if v_role <> 'admin' then raise exception 'Only Admin can consume stock without a project.'; end if;
    if coalesce(trim(p_note), '') = '' then
      raise exception 'Enter a reason (e.g. R&D, sample) for stock consumption.';
    end if;
  end if;

  select * into v_scanned from public.inventory_lots where id = p_lot;
  if not found then raise exception 'Lot not found.'; end if;
  v_box := coalesce(v_scanned.source_lot_id, v_scanned.id);

  -- Lock the box and everything reserved inside it, so two scans of the
  -- same box can't both draw the same stock.
  perform 1 from public.inventory_lots
   where id = v_box or source_lot_id = v_box
   order by id
   for update;

  -- Raw job-work stock can't be consumed — it must go for job work first.
  if exists (select 1 from public.inventory_lots where id = v_box and jw_stage = 'raw') then
    raise exception 'This is a raw job-work lot — send it for job work and receive the completed part before consuming.';
  end if;

  select coalesce(sum(qty_on_hand) filter (
           where p_project is not null and status = 'issued' and project_id = p_project), 0),
         coalesce(sum(qty_on_hand) filter (
           where status = 'open' and (project_id is null or p_project is null or project_id = p_project)), 0)
    into v_reserved, v_open
    from public.inventory_lots
   where (id = v_box or source_lot_id = v_box) and qty_on_hand > 0;

  if v_reserved + v_open < p_qty then
    if v_reserved + v_open = 0 and exists (
      select 1 from public.inventory_lots
       where (id = v_box or source_lot_id = v_box) and qty_on_hand > 0 and status = 'issued'
    ) then
      raise exception 'This box is reserved for another project and cannot be consumed here.';
    end if;
    raise exception 'Only % available in this box (% reserved for this project + % open).',
      v_reserved + v_open, v_reserved, v_open;
  end if;

  v_ref := case when p_requisition is not null then 'requisition'
                when p_project is not null then 'scan'
                else 'scan-stock' end;
  v_left := p_qty;

  -- Reserved for this project first (oldest first), then open stock (the
  -- box itself before any open slice inside it).
  for r in
    select id, component_id, qty_on_hand, status
      from public.inventory_lots
     where (id = v_box or source_lot_id = v_box) and qty_on_hand > 0
       and (
         (p_project is not null and status = 'issued' and project_id = p_project)
         or (status = 'open' and (project_id is null or p_project is null or project_id = p_project))
       )
     order by (status = 'issued') desc, (id = v_box) desc, created_at, id
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty_on_hand);
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, note, performed_by, created_by)
    values (r.id, r.component_id, 'issue', -v_take, p_project,
      v_ref, p_requisition, nullif(trim(p_note), ''), v_uid, v_uid);
    perform public._move_mpn(r.id, null, v_take, v_uid);
    if r.status = 'issued' then v_from_res := v_from_res + v_take; else v_from_open := v_from_open + v_take; end if;
    v_left := v_left - v_take;
  end loop;

  if p_project is not null then
    v_freed := public._auto_release(p_project, v_scanned.component_id, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'from_reserved', v_from_res, 'from_open', v_from_open, 'released', v_freed);
end; $$;

-- Manual Unissue, all (p_qty null) or part of a reserved lot.
create or replace function public.release_blocked_lot(p_lot uuid, p_qty numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot   record;
  v_freed numeric;
begin
  if coalesce(public.auth_role()::text, '') not in ('admin', 'team_lead', 'inventory_admin') then
    raise exception 'Only Admin / Team Lead / Inventory Admin can unissue a lot.';
  end if;
  if p_qty is not null and p_qty <= 0 then raise exception 'Enter a quantity to unissue.'; end if;

  select * into v_lot from public.inventory_lots where id = p_lot;
  if not found then raise exception 'Lot not found.'; end if;
  if v_lot.status <> 'issued' then raise exception 'This lot is not reserved for a project.'; end if;
  if p_qty is not null and p_qty > v_lot.qty_on_hand then
    raise exception 'Only % reserved in this lot.', v_lot.qty_on_hand;
  end if;

  perform 1 from public.inventory_lots
   where id = coalesce(v_lot.source_lot_id, v_lot.id) or source_lot_id = coalesce(v_lot.source_lot_id, v_lot.id)
   order by id
   for update;

  v_freed := public._release_lot(p_lot, p_qty, auth.uid());
  return jsonb_build_object('ok', true, 'released', v_freed);
end; $$;

-- Run auto-release for every component a project has reserved — called
-- when a BOM is approved so extra stock is freed straight away.
create or replace function public.recheck_project_reservations(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r       record;
  v_freed numeric := 0;
begin
  if coalesce(public.auth_role()::text, '') not in ('admin', 'team_lead', 'inventory_admin') then
    raise exception 'Not authorized.';
  end if;
  for r in
    select distinct component_id from public.inventory_lots
     where project_id = p_project and status = 'issued' and qty_on_hand > 0 and component_id is not null
  loop
    v_freed := v_freed + public._auto_release(p_project, r.component_id, auth.uid());
  end loop;
  return jsonb_build_object('ok', true, 'released', v_freed);
end; $$;

-- ---- 4. issue_requisition (from 0068) ----
-- Changes: partial takes go through _make_slice (linked to the box, MPN
-- breakdown moves with it); raw job-work lots are skipped; the box's
-- qty_initial is no longer reduced (Initial stays what was received).
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
    -- THIS project; never grab an open lot tagged to a different project, and
    -- never raw job-work stock (it can't be consumed until it's been machined).
    FOR v_lot IN
      SELECT id, qty_on_hand
      FROM   public.inventory_lots
      WHERE  component_id = v_line.component_id
        AND  status = 'open'
        AND  qty_on_hand > 0
        AND  (project_id IS NULL OR project_id = v_req.project_id)
        AND  jw_stage IS DISTINCT FROM 'raw'
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
        PERFORM public._make_slice(v_lot.id, v_take, 'issued', v_req.project_id,
                                   p_user_id, 'requisition_block', p_req_id);
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

-- ---- 5. grn_line_after_insert (from 0105) ----
-- Change: case (a), receiving project-tagged stock INTO an existing box,
-- used to land in the box as plain open stock — the project's reservation
-- was silently lost. It now becomes a slice inside that box, reserved for
-- the project, carrying grn_line_id (so it keeps its own PO rate). Every
-- other branch is unchanged.
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
  v_box        record;
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

  -- (a) Add-to-existing-box.
  if NEW.target_lot_id is not null then
    -- Project-tagged receipt: a slice inside the box, reserved for the
    -- project. The receipt lands straight in the slice, so the box's own
    -- (open) count and MPN breakdown are untouched.
    if NEW.project_id is not null then
      select * into v_box from public.inventory_lots where id = NEW.target_lot_id;
      v_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id, source_lot_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, location, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id, coalesce(v_box.source_lot_id, v_box.id),
        0, NEW.qty_received, NEW.unit_cost, coalesce(v_is_ser, false), 'issued', v_stage,
        coalesce(v_box.location, NEW.location), NEW.created_by)
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
    end if;

    -- Untagged: no new lot, just a receipt movement into the chosen box.
    -- Unlike location (which a box only ever has one of), a box CAN
    -- genuinely hold more than one MPN — record/accumulate this receipt's
    -- MPN in the box's breakdown instead of leaving it untouched.
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

-- ---- 6. Views ----
-- Valuation: a slice carved from a box has no GRN link of its own, so it
-- fell back to unit_cost. Price = own PO rate, else the box's PO rate,
-- else unit cost. Columns unchanged (v_component_on_hand_safe depends on it).

create or replace view public.v_component_on_hand with (security_invoker = true) as
select c.id as component_id, c.component_no, c.name, c.uom,
       coalesce(sum(l.qty_on_hand), 0)                                              as qty_on_hand,
       coalesce(sum(l.qty_on_hand * coalesce(pl.rate, spl.rate, l.unit_cost)), 0)   as stock_value,
       count(l.id) filter (where l.status <> 'consumed')                           as lot_count,
       count(l.id) > 0                                                             as has_stock_history
from public.components c
left join public.inventory_lots l
       on l.component_id = c.id
left join public.grn_lines gl
       on gl.id = l.grn_line_id
left join public.po_lines pl
       on pl.id = gl.po_line_id and pl.approval_status = 'approved'
left join public.inventory_lots sl
       on sl.id = l.source_lot_id
left join public.grn_lines sgl
       on sgl.id = sl.grn_line_id
left join public.po_lines spl
       on spl.id = sgl.po_line_id and spl.approval_status = 'approved'
group by c.id, c.component_no, c.name, c.uom;

create or replace view public.v_project_consumption with (security_invoker = true) as
select
  m.project_id,
  m.component_id,
  sum(-m.qty) as consumed_qty,
  sum((-m.qty) * coalesce(pl.rate, spl.rate, l.unit_cost)) as consumption_value
from stock_movements m
join inventory_lots l on l.id = m.lot_id
left join grn_lines gl on gl.id = l.grn_line_id
left join po_lines pl on pl.id = gl.po_line_id and pl.approval_status = 'approved'::po_line_approval_status
left join inventory_lots sl on sl.id = l.source_lot_id
left join grn_lines sgl on sgl.id = sl.grn_line_id
left join po_lines spl on spl.id = sgl.po_line_id and spl.approval_status = 'approved'::po_line_approval_status
where m.movement_type = any (array['issue'::movement_type, 'return'::movement_type])
  and m.project_id is not null
group by m.project_id, m.component_id;

-- v_bom_variance: only `rcv` changes. A project-reserved lot with no GRN
-- line counts as received; for a slice that is what was drawn from it +
-- what's still reserved (qty_initial would over-count once part of it has
-- been handed back), and a slice carved from the project's OWN GRN stock
-- isn't counted at all — that receipt is already counted via grn_lines.
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
    select l.project_id, l.component_id,
           case when l.source_lot_id is null then l.qty_initial
                else l.qty_on_hand + coalesce((
                  select sum(-m.qty) from public.stock_movements m
                   where m.lot_id = l.id and m.movement_type in ('issue', 'return')
                ), 0)
           end as qty
    from public.inventory_lots l
    where l.project_id is not null and l.component_id is not null
      and l.grn_line_id is null
      and l.status = any (array['issued'::lot_status, 'consumed'::lot_status])
      and not exists (
        select 1 from public.inventory_lots s
        join public.grn_lines sgl on sgl.id = s.grn_line_id
        where s.id = l.source_lot_id and sgl.project_id = l.project_id
      )
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

-- ---- 7. Grants ----
-- Internal helpers are only ever called from the security-definer
-- functions above; nobody calls them directly.
revoke all on function public._move_mpn(uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public._make_slice(uuid, numeric, public.lot_status, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public._release_lot(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public._auto_release(uuid, uuid, uuid) from public, anon, authenticated;

revoke all on function public.consume_from_lot(uuid, numeric, uuid, uuid, text) from public, anon;
revoke all on function public.release_blocked_lot(uuid, numeric) from public, anon;
revoke all on function public.recheck_project_reservations(uuid) from public, anon;
grant execute on function public.consume_from_lot(uuid, numeric, uuid, uuid, text) to authenticated;
grant execute on function public.release_blocked_lot(uuid, numeric) to authenticated;
grant execute on function public.recheck_project_reservations(uuid) to authenticated;

-- ============================================================
-- 0027 — issue_requisition: best-effort partial reservation (don't roll back
-- on shortfall — block what's available, leave the rest short), re-runnable,
-- and only reserves open lots that are untagged or already tagged to THIS
-- project (an 'open' lot tagged to another project — e.g. via a project PO —
-- must not be silently grabbed by a different project's block/issue action).
-- ============================================================
CREATE OR REPLACE FUNCTION public.issue_requisition(p_req_id uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req         RECORD;
  v_line        RECORD;
  v_lot         RECORD;
  v_remaining   numeric;
  v_take        numeric;
  v_new_code    text;
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
        SET qty_on_hand = qty_on_hand - v_take,
            qty_initial = qty_initial - v_take
        WHERE id = v_lot.id;

        v_new_code := 'LOT-' || to_char(now(), 'YYMMDD') || '-'
                   || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
        INSERT INTO public.inventory_lots(
          lot_code, component_id, vendor_id, project_id,
          qty_on_hand, qty_initial, unit_cost, location,
          is_serialized, status, created_by)
        SELECT v_new_code, v_line.component_id, vendor_id, v_req.project_id,
               v_take, v_take, unit_cost, location,
               is_serialized, 'issued', p_user_id
        FROM   public.inventory_lots WHERE id = v_lot.id;
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
$$;

-- Hardening from 0022, deferred to here since the function didn't exist yet.
revoke execute on function public.issue_requisition(uuid, uuid) from anon, public;

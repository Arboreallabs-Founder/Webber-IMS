-- ============================================================
-- 0104 — Capture a lot's storage location right at GRN receiving,
-- instead of only afterward via the lot detail page's "Transfer"
-- form. "Add to an existing box" is left untouched, same as mpn_id in
-- 0100: an existing box already has a location, so this flow never
-- changes it — the app layer blocks the input in that case too.
-- ============================================================

alter table public.grn_lines add column location text;
alter table public.irns add column location text;

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
      insert into public.inventory_lots(
        lot_code, component_id, grn_line_id, vendor_id, project_id, parent_lot_id,
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, mpn_id, location,
        container_no, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id, v_jwline.raw_lot_id,
        0, case when v_n > 1 then 1 else NEW.qty_received end, NEW.unit_cost,
        case when v_track = 'item' then true else coalesce(v_is_ser, false) end,
        v_status, 'completed'::public.jw_stage, NEW.mpn_id, NEW.location,
        case when v_track = 'box' then v_code else null end, NEW.created_by)
      returning id into v_lot;
      insert into public.stock_movements(
        lot_id, component_id, movement_type, qty, project_id,
        reference_type, reference_id, performed_by, created_by)
      values (v_lot, NEW.component_id, 'receipt', case when v_n > 1 then 1 else NEW.qty_received end, NEW.project_id,
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
  -- chosen box. location (like mpn_id) is deliberately not touched here —
  -- the box keeps wherever it's already stored.
  if NEW.target_lot_id is not null then
    insert into public.stock_movements(
      lot_id, component_id, movement_type, qty, project_id,
      reference_type, reference_id, performed_by, created_by)
    values (NEW.target_lot_id, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
      'grn', NEW.id, NEW.created_by, NEW.created_by);
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
        qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, mpn_id, location, created_by)
      values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
        0, 1, NEW.unit_cost, true, v_status, v_stage, NEW.mpn_id, NEW.location, NEW.created_by)
      returning id into v_lot;
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
    qty_on_hand, qty_initial, unit_cost, is_serialized, status, jw_stage, mpn_id, location,
    container_no, created_by)
  values (v_code, NEW.component_id, NEW.id, v_vendor, NEW.project_id,
    0, NEW.qty_received, NEW.unit_cost, coalesce(v_is_ser, false), v_status, v_stage, NEW.mpn_id, NEW.location,
    case when v_track = 'box' then v_code else null end, NEW.created_by)
  returning id into v_lot;
  insert into public.stock_movements(
    lot_id, component_id, movement_type, qty, project_id,
    reference_type, reference_id, performed_by, created_by)
  values (v_lot, NEW.component_id, 'receipt', NEW.qty_received, NEW.project_id,
    'grn', NEW.id, NEW.created_by, NEW.created_by);
  return NEW;
end; $$;

-- ---- submit_irn / approve_irn: thread location through the inspection
-- path too, the same way mpn_id was in 0100.
create or replace function public.submit_irn(
  p_grn_id uuid, p_component_id uuid, p_qty numeric, p_unit_cost numeric, p_po_line_id uuid,
  p_project_id uuid, p_piece_count numeric, p_piece_length numeric, p_piece_width numeric,
  p_answers jsonb, p_submitter_id uuid, p_target_lot_id uuid default null,
  p_piece_weight numeric default null, p_jw_line_id uuid default null, p_signature_id uuid default null,
  p_mpn_id uuid default null, p_location text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.role;
  v_actor uuid := auth.uid();
  v_template uuid;
  v_irn uuid;
  v_pno text;
  v_field record;
  v_ans jsonb;
  v_missing text[] := '{}';
  v_res jsonb;
begin
  if p_qty is null or p_qty <= 0 then return jsonb_build_object('error','Quantity must be positive'); end if;

  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead','team_member') then
    return jsonb_build_object('error','Not authorized to submit an inspection report.');
  end if;

  if p_mpn_id is not null and not exists (
    select 1 from public.component_mpns where id = p_mpn_id and component_id = p_component_id
  ) then
    return jsonb_build_object('error', 'That MPN does not belong to the selected component');
  end if;

  select inspection_template_id into v_template from public.components where id = p_component_id;
  if v_template is null then return jsonb_build_object('error','This component has no inspection template attached'); end if;

  for v_field in
    select id, label, is_required from public.inspection_template_fields
    where template_id = v_template and is_active = true
      and not exists (
        select 1 from public.component_inspection_field_exclusions x
        where x.component_id = p_component_id and x.field_id = inspection_template_fields.id
      )
  loop
    v_ans := (select a from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) a where a->>'field_id' = v_field.id::text limit 1);
    if v_field.is_required and (v_ans is null or (v_ans->>'value') is null or trim(v_ans->>'value') = '') then
      v_missing := array_append(v_missing, v_field.label);
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('error', 'Missing required field(s): ' || array_to_string(v_missing, ', '));
  end if;

  select public.next_irn_no() into v_pno;
  insert into public.irns(irn_no, grn_id, component_id, template_id, qty, unit_cost, po_line_id, project_id,
        piece_count, piece_length, piece_width, piece_weight, target_lot_id, jw_line_id, mpn_id, location, generated_by, created_by)
  values (v_pno, p_grn_id, p_component_id, v_template, p_qty, p_unit_cost, p_po_line_id, p_project_id,
        p_piece_count, p_piece_length, p_piece_width, p_piece_weight, p_target_lot_id, p_jw_line_id, p_mpn_id, p_location, v_actor, v_actor)
  returning id into v_irn;

  for v_field in
    select id, field_type from public.inspection_template_fields
    where template_id = v_template and is_active = true
      and not exists (
        select 1 from public.component_inspection_field_exclusions x
        where x.component_id = p_component_id and x.field_id = inspection_template_fields.id
      )
  loop
    v_ans := (select a from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) a where a->>'field_id' = v_field.id::text limit 1);
    if v_ans is not null and (v_ans->>'value') is not null and trim(v_ans->>'value') <> '' then
      insert into public.irn_answers(irn_id, field_id, text_value, number_value, choice_value, created_by)
      values (
        v_irn, v_field.id,
        case when v_field.field_type in ('text','link') then v_ans->>'value' else null end,
        case when v_field.field_type = 'number' then (v_ans->>'value')::numeric else null end,
        case when v_field.field_type in ('choice','checkbox') then v_ans->>'value' else null end,
        v_actor
      );
    end if;
  end loop;

  if v_role in ('admin','team_lead') and p_signature_id is not null then
    v_res := public.approve_irn(v_irn, v_actor, p_signature_id, null);
    if not (v_res ? 'error') then
      return v_res || jsonb_build_object('id', v_irn, 'irn_no', v_pno, 'status', 'approved');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_irn, 'irn_no', v_pno, 'status', 'pending_approval');
end; $function$;

create or replace function public.approve_irn(p_irn_id uuid, p_approver_id uuid, p_signature_id uuid, p_remarks text default null::text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_role public.role;
  v_irn record;
  v_line_id uuid;
  v_img text;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    return jsonb_build_object('error','Only Admin / Team Lead can approve.');
  end if;

  select image_data_url into v_img from public.signatures where id = p_signature_id and user_id = auth.uid();
  if not found then
    return jsonb_build_object('error', 'Signature not found.');
  end if;

  select * into v_irn from public.irns where id = p_irn_id for update;
  if not found then return jsonb_build_object('error','IRN not found'); end if;
  if v_irn.status <> 'pending_approval' then
    return jsonb_build_object('error','IRN is not pending approval (already '||v_irn.status||')');
  end if;

  insert into public.grn_lines(grn_id, component_id, qty_received, po_line_id, project_id, unit_cost, target_lot_id, jw_line_id, mpn_id, location, created_by)
  values (v_irn.grn_id, v_irn.component_id, v_irn.qty, v_irn.po_line_id, v_irn.project_id, v_irn.unit_cost, v_irn.target_lot_id, v_irn.jw_line_id, v_irn.mpn_id, v_irn.location, v_irn.generated_by)
  returning id into v_line_id;

  if v_irn.piece_count is not null or v_irn.piece_length is not null or v_irn.piece_width is not null or v_irn.piece_weight is not null then
    update public.inventory_lots
       set piece_count = v_irn.piece_count, piece_length = v_irn.piece_length, piece_width = v_irn.piece_width, piece_weight = v_irn.piece_weight
     where grn_line_id = v_line_id;
  end if;

  update public.irns
     set status = 'approved', approved_by = auth.uid(), approved_at = now(), grn_line_id = v_line_id,
         approval_remarks = nullif(trim(p_remarks), '')
   where id = p_irn_id;

  perform public._record_signature('grn', v_irn.grn_id, p_signature_id, auth.uid());

  return jsonb_build_object('ok', true, 'grn_line_id', v_line_id);
end; $function$;

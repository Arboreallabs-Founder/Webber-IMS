-- Four SECURITY DEFINER RPCs had no internal role check at all — they relied
-- entirely on the app's UI-layer gate (canWriteMasters / PROCURE / PRODUCE),
-- which a direct supabase.rpc() call bypasses since SECURITY DEFINER skips
-- table RLS too. Adding the new 'viewer' role (view-only, no create/update/
-- delete anywhere) surfaced this: without this fix, a viewer could call
-- these RPCs directly and mutate real data despite RLS blocking every plain
-- table write. Each gets the exact same role check the app already enforces
-- for it (see roles.ts canWriteMasters / requisitions.ts PROCURE /
-- finished-goods/actions.ts PRODUCE) — same pattern as migration 0065.

create or replace function public.promote_assembly_line(p_line uuid, p_component_no text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   public.role;
  v_line   public.bom_template_lines%rowtype;
  v_name   text;
  v_cno    text;
  v_comp   uuid;
  v_subtpl uuid;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    raise exception 'Not authorized to edit BOM templates.';
  end if;

  select * into v_line from public.bom_template_lines where id = p_line;
  if not found then
    raise exception 'BOM line % not found', p_line;
  end if;
  if coalesce(v_line.line_type, '') <> 'assembly' then
    raise exception 'BOM line % is not a sub-assembly folder', p_line;
  end if;
  if v_line.component_id is not null then
    raise exception 'BOM line % is already backed by a component', p_line;
  end if;

  v_name := coalesce(nullif(btrim(v_line.assembly_name), ''),
                     nullif(btrim(v_line.section), ''),
                     'Sub-assembly');
  v_cno := coalesce(nullif(btrim(p_component_no), ''),
                    'ASM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));

  insert into public.components (component_no, name, is_assembly, tracking_mode)
  values (v_cno, v_name, true, 'item')
  returning id into v_comp;

  insert into public.bom_templates (component_id, version, is_active)
  values (v_comp, 1, true)
  returning id into v_subtpl;

  with recursive subtree as (
    select id, parent_line_id
      from public.bom_template_lines
     where parent_line_id = p_line
    union all
    select c.id, c.parent_line_id
      from public.bom_template_lines c
      join subtree s on c.parent_line_id = s.id
  )
  update public.bom_template_lines l
     set bom_template_id = v_subtpl,
         parent_line_id  = case when l.parent_line_id = p_line then null else l.parent_line_id end,
         section         = null
    from subtree
   where l.id = subtree.id;

  update public.bom_template_lines
     set component_id = v_comp,
         quantity     = coalesce(nullif(quantity, 0), 1)
   where id = p_line;

  return v_comp;
end;
$$;

create or replace function public.duplicate_product_bom(p_src_template uuid, p_sku text, p_model text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  public.role;
  v_src   public.bom_templates%rowtype;
  v_prod  public.products%rowtype;
  v_sku   text;
  v_model text;
  v_new_prod uuid;
  v_new_tpl  uuid;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    raise exception 'Not authorized to edit BOM templates.';
  end if;

  select * into v_src from public.bom_templates where id = p_src_template;
  if not found or v_src.product_id is null then
    raise exception 'source % is not a product BOM template', p_src_template;
  end if;
  select * into v_prod from public.products where id = v_src.product_id;

  v_sku   := coalesce(nullif(btrim(p_sku), ''),   v_prod.sku_code || '-COPY');
  v_model := coalesce(nullif(btrim(p_model), ''), v_prod.model_name || ' (copy)');

  insert into public.products (sku_code, model_name, category_id, is_serialized, description)
  values (v_sku, v_model, v_prod.category_id, v_prod.is_serialized, v_prod.description)
  returning id into v_new_prod;

  insert into public.bom_templates (product_id, version, is_active)
  values (v_new_prod, 1, true)
  returning id into v_new_tpl;

  insert into public.product_variant_params
    (product_id, name, input_type, options, min_value, max_value, uom, sort_order)
  select v_new_prod, name, input_type, options, min_value, max_value, uom, sort_order
  from public.product_variant_params
  where product_id = v_src.product_id;

  with src as (
    select *, gen_random_uuid() as new_id
    from public.bom_template_lines
    where bom_template_id = p_src_template
  )
  insert into public.bom_template_lines
    (id, bom_template_id, component_id, quantity, is_common, is_variant_driven,
     variant_rule, note, parent_line_id, line_type, section, assembly_name,
     sort_order, variant_group, variation)
  select s.new_id, v_new_tpl, s.component_id, s.quantity, s.is_common, s.is_variant_driven,
         s.variant_rule, s.note, p.new_id, s.line_type, s.section, s.assembly_name,
         s.sort_order, s.variant_group, s.variation
  from src s
  left join src p on p.id = s.parent_line_id;

  return v_new_tpl;
end;
$$;

create or replace function public.issue_requisition(p_req_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_role        public.role;
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
  v_role := public.auth_role();
  IF v_role IS NULL OR v_role NOT IN ('admin','team_lead') THEN
    RETURN jsonb_build_object('error', 'Only Admin / Team Lead can issue requisitions.');
  END IF;

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
    v_remaining := v_line.qty - coalesce((
      SELECT sum(qty_on_hand) FROM public.inventory_lots
      WHERE component_id = v_line.component_id AND status = 'issued' AND project_id = v_req.project_id
    ), 0);
    IF v_remaining <= 0 THEN
      v_any_covered := true;
      CONTINUE;
    END IF;

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
$$;

create or replace function public.log_finished_goods(
  p_project_id uuid,
  p_project_line_item_id uuid default null,
  p_product_id uuid default null,
  p_custom_name text default null,
  p_quantity integer default 1,
  p_status fg_status default 'in_production',
  p_user_id uuid default null
)
returns setof finished_goods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.role;
  v_bom_status public.bom_status;
  v_li_project uuid;
  v_li_product uuid;
  v_li_qty     int;
  v_li_variant jsonb;
  v_already    int;
  v_product    uuid;
  v_variant    jsonb;
  v_serial     text;
  v_row        public.finished_goods%rowtype;
  i            int;
begin
  v_role := public.auth_role();
  if v_role is null or v_role not in ('admin','team_lead') then
    raise exception 'Only Admin / Team Lead can log finished goods.';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'Quantity must be between 1 and 1000';
  end if;

  select status into v_bom_status from public.boms where project_id = p_project_id;
  if v_bom_status is distinct from 'approved' then
    raise exception 'Approve the project BOM before logging finished goods';
  end if;

  if not exists (
    select 1 from public.stock_movements
    where project_id = p_project_id and movement_type = 'issue'
  ) then
    raise exception 'Nothing has been issued/consumed on this project yet';
  end if;

  if p_project_line_item_id is not null then
    select project_id, product_id, quantity, variant_selections
      into v_li_project, v_li_product, v_li_qty, v_li_variant
      from public.project_line_items where id = p_project_line_item_id
      for update;

    if not found then
      raise exception 'Line item not found';
    end if;
    if v_li_project <> p_project_id then
      raise exception 'Line item does not belong to this project';
    end if;

    select count(*) into v_already
      from public.finished_goods where project_line_item_id = p_project_line_item_id;

    if v_already + p_quantity > v_li_qty then
      raise exception 'Only % of % ordered on this line item remain unlogged',
        greatest(v_li_qty - v_already, 0), v_li_qty;
    end if;

    v_product := v_li_product;
    v_variant := v_li_variant;
  else
    if (p_product_id is null) = (p_custom_name is null) then
      raise exception 'Provide either a product or a custom name, not both';
    end if;
    v_product := p_product_id;
    v_variant := null;
  end if;

  for i in 1..p_quantity loop
    select public.next_fg_no() into v_serial;
    insert into public.finished_goods(
      project_line_item_id, product_id, custom_name, serial_no, status, variant_selections, created_by)
    values (
      p_project_line_item_id, v_product,
      case when p_project_line_item_id is null then p_custom_name else null end,
      v_serial, p_status, v_variant, p_user_id)
    returning * into v_row;
    return next v_row;
  end loop;
  return;
end;
$$;

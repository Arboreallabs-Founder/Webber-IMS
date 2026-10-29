-- ============================================================
-- 0095 — Log finished goods from the project page, not a bare
-- disconnected form. A "Log finished good" control on the project page
-- now creates finished_goods rows via log_finished_goods(), gated on the
-- project's BOM being approved and something already issued/consumed.
--
-- Two modes:
--   (a) project has line items -> pick a line item + quantity; the
--       product is taken from the line item, and quantity is capped at
--       what's left unlogged against that line's ordered quantity.
--   (b) project has no line items (BOM-only) -> either an existing
--       catalog product, or a free-text custom name (new).
--
-- Also defines next_fg_no(), which the app already called via RPC
-- (src/app/(app)/finished-goods/actions.ts) but which no migration ever
-- created — the same "applied live, never committed" drift class as
-- quantity_type / issue_requisition found in the earlier migration audit.
-- ============================================================

-- A finished good no longer requires a catalog product — a custom BOM
-- with no matching product master can still be named on the spot.
alter table public.finished_goods
  alter column product_id drop not null,
  add column custom_name text;

alter table public.finished_goods
  add constraint finished_goods_product_or_name_chk
  check (
    case
      -- line-item path: product always comes from the line item, never a custom name
      when project_line_item_id is not null then product_id is not null and custom_name is null
      -- no line item: exactly one of product_id / custom_name
      else (product_id is not null) <> (custom_name is not null)
    end
  );

-- ---- FG numbering (was called by the app, never defined in a migration) ----
create sequence if not exists public.seq_fg_no;
create or replace function public.next_fg_no() returns text
  language sql set search_path = public as $$
  select 'FG/' || public.fiscal_year_label() || '/' || lpad(nextval('public.seq_fg_no')::text,4,'0'); $$;
grant execute on function public.next_fg_no() to authenticated;

-- ---- log_finished_goods(...) --------------------------------------------
create or replace function public.log_finished_goods(
  p_project_id           uuid,
  p_project_line_item_id uuid default null,
  p_product_id           uuid default null,
  p_custom_name          text default null,
  p_quantity             int  default 1,
  p_status               public.fg_status default 'in_production',
  p_user_id              uuid default null
) returns setof public.finished_goods
language plpgsql security definer set search_path = public as $$
declare
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
    -- lock the line item so two concurrent submits can't both slip past the cap
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

revoke execute on function public.log_finished_goods(uuid, uuid, uuid, text, int, public.fg_status, uuid) from anon, public;
grant execute on function public.log_finished_goods(uuid, uuid, uuid, text, int, public.fg_status, uuid) to authenticated;

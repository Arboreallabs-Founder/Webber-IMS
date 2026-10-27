-- Consumables.
--
-- components.is_consumable    — ticked by a full Admin in Master Data.
-- vendors.is_consumables_vendor — Arbuda Steel and Hardware and Bharat Electric &
--                                 Hardware Store now; more can be ticked later.
-- purchase_orders.is_consumables — set on POs raised from the Consumables module.
--
-- A PO belongs to Consumables when it was raised there, or — for older POs —
-- when its vendor is a consumables vendor and every one of its lines is a
-- consumable component (so it moves as the components get ticked).
--
-- Rules:
--   * Consumables POs: consumables vendor, consumable components, plain stock
--     (no project) on every new line.
--   * Normal POs never take a consumable component (lines copied into a
--     revision, and lines for a component the PO already carried, excepted).
--   * Consumable stock is never blocked for a project: a project-tagged receipt
--     arrives as open stock, and nothing can newly reserve a consumable lot.
--     Projects consume it straight from open stock through requisitions.
--   * Only a full Admin can tick or untick either flag.

alter table public.components add column if not exists is_consumable boolean not null default false;
alter table public.vendors add column if not exists is_consumables_vendor boolean not null default false;
alter table public.purchase_orders add column if not exists is_consumables boolean not null default false;

update public.vendors set is_consumables_vendor = true
 where name in ('Arbuda Steel and Hardware', 'Bharat Electric & Hardware Store');

-- ---------- who may tick ----------
create or replace function public.guard_consumable_flags()
 returns trigger language plpgsql set search_path to 'public'
as $$
declare v_changed boolean;
begin
  if tg_table_name = 'components' then
    v_changed := (tg_op = 'INSERT' and new.is_consumable) or (tg_op = 'UPDATE' and new.is_consumable is distinct from old.is_consumable);
  else
    v_changed := (tg_op = 'INSERT' and new.is_consumables_vendor) or (tg_op = 'UPDATE' and new.is_consumables_vendor is distinct from old.is_consumables_vendor);
  end if;
  if v_changed and auth.uid() is not null
     and (coalesce(public.auth_role()::text, '') <> 'admin' or public.auth_is_factory_admin()) then
    raise exception 'Only an Admin can change what counts as a consumable.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
drop trigger if exists trg_components_guard_consumable on public.components;
create trigger trg_components_guard_consumable before insert or update on public.components
  for each row execute function public.guard_consumable_flags();
drop trigger if exists trg_vendors_guard_consumable on public.vendors;
create trigger trg_vendors_guard_consumable before insert or update on public.vendors
  for each row execute function public.guard_consumable_flags();

-- ---------- which POs are Consumables ----------
create or replace view public.v_po_kind
with (security_invoker = true) as
select po.id as po_id,
       (po.is_consumables
        or (coalesce(v.is_consumables_vendor, false)
            and exists (select 1 from public.po_lines l where l.po_id = po.id)
            and not exists (select 1 from public.po_lines l join public.components c on c.id = l.component_id
                             where l.po_id = po.id and not c.is_consumable))) as is_consumables
  from public.purchase_orders po
  left join public.vendors v on v.id = po.vendor_id;

create or replace function public.po_is_consumables(p_po uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce((select is_consumables from public.v_po_kind where po_id = p_po), false) $$;
revoke execute on function public.po_is_consumables(uuid) from anon;

-- ---------- PO header ----------
create or replace function public.purchase_orders_guard_consumables()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.is_consumables and new.vendor_id is not null
     and not coalesce((select is_consumables_vendor from public.vendors where id = new.vendor_id), false) then
    raise exception 'A Consumables PO can only go to a consumables vendor.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_orders_guard_consumables on public.purchase_orders;
create trigger trg_purchase_orders_guard_consumables before insert or update of vendor_id, is_consumables on public.purchase_orders
  for each row execute function public.purchase_orders_guard_consumables();

-- ---------- PO lines ----------
create or replace function public.po_lines_guard_consumables()
 returns trigger language plpgsql set search_path to 'public'
as $$
declare
  v_consumable boolean;
  v_cons_po    boolean;
  v_root       uuid;
  v_no         text;
begin
  -- Lines copied unchanged into a PO revision keep whatever they were.
  if coalesce(current_setting('yaha.po_line_approval_bypass', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.component_id is not distinct from old.component_id
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;

  select is_consumable, component_no into v_consumable, v_no from public.components where id = new.component_id;
  v_cons_po := public.po_is_consumables(new.po_id);

  if v_cons_po then
    if not coalesce(v_consumable, false) then
      raise exception '% is not a consumable — order it on a normal PO.', coalesce(v_no, 'This component')
        using errcode = 'check_violation';
    end if;
    if new.project_id is not null then
      raise exception 'Consumables are bought for stock only — leave the project empty.' using errcode = 'check_violation';
    end if;
    if not coalesce((select v.is_consumables_vendor from public.purchase_orders po join public.vendors v on v.id = po.vendor_id
                      where po.id = new.po_id), false) then
      raise exception 'A Consumables PO can only go to a consumables vendor.' using errcode = 'check_violation';
    end if;
  elsif coalesce(v_consumable, false) then
    -- A normal PO may keep a consumable it already carried (older POs); never a new one.
    select coalesce(root_po_id, id) into v_root from public.purchase_orders where id = new.po_id;
    if not exists (
      select 1 from public.po_lines l join public.purchase_orders p on p.id = l.po_id
       where l.component_id = new.component_id and coalesce(p.root_po_id, p.id) = v_root
         and (tg_op = 'INSERT' or l.id <> new.id))
    then
      raise exception '% is a consumable — order it from the Consumables module.', coalesce(v_no, 'This component')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_po_lines_guard_consumables on public.po_lines;
create trigger trg_po_lines_guard_consumables before insert or update of component_id, project_id on public.po_lines
  for each row execute function public.po_lines_guard_consumables();

-- Revisions keep the Consumables mark.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.clone_po_revision(uuid, text, uuid, jsonb, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$     delivery_address, terms_conditions,
     root_po_id, revision_no, created_by)$s$,
    $s$     delivery_address, terms_conditions,
     root_po_id, revision_no, created_by, is_consumables)$s$);
  v_new := replace(v_new,
    $s$    v_root_id, v_new_revno, p_actor
  )
  returning id into v_new_id;$s$,
    $s$    v_root_id, v_new_revno, p_actor, v_old.is_consumables
  )
  returning id into v_new_id;$s$);
  if v_new = v_def or v_new not like '%v_old.is_consumables%' or v_new not like '%created_by, is_consumables)%' then
    raise exception 'clone_po_revision: pattern not found';
  end if;
  execute v_new;
end $$;

-- ---------- consumable stock is never blocked ----------
create or replace function public.lots_consumables_not_blocked()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.status = 'issued' and new.project_id is not null
     and coalesce((select is_consumable from public.components where id = new.component_id), false) then
    if tg_op = 'INSERT' and new.grn_line_id is not null then
      -- Received on a project PO: arrives as open stock instead of reserved.
      new.status := 'open';
      new.project_id := null;
    elsif tg_op = 'INSERT' or old.project_id is distinct from new.project_id then
      raise exception 'Consumables can''t be blocked for a project — consume them straight from stock through a requisition.'
        using errcode = 'check_violation';
    end if;
    -- Otherwise the lot already belonged to this project (an existing block, or a
    -- consumption being reversed back onto it) and is left as it was.
  end if;
  return new;
end $$;
drop trigger if exists trg_lots_consumables_not_blocked on public.inventory_lots;
create trigger trg_lots_consumables_not_blocked before insert or update of status, project_id on public.inventory_lots
  for each row execute function public.lots_consumables_not_blocked();

-- Requisition / BOM blocking skips consumables instead of failing on them.
do $$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.issue_requisition(uuid, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$    WHERE  rl.requisition_id = p_req_id
  LOOP$s$,
    $s$    WHERE  rl.requisition_id = p_req_id
      AND  NOT c.is_consumable
  LOOP$s$);
  if v_new = v_def then raise exception 'issue_requisition: pattern not found'; end if;
  execute v_new;
end $$;

-- ============================================================
-- 0117 — BOM Builder "New BOM" in one transaction.
--
-- startBom used to insert the category (when typed in), then the product,
-- then its BOM template as three separate calls. If a later insert failed,
-- the earlier rows stayed behind — a product with no BOM, which BOM Builder
-- never lists. Doing all three in one function makes it all-or-nothing.
--
-- Security invoker: the caller's own RLS on categories / products /
-- bom_templates applies, exactly as with the separate inserts before.
-- ============================================================

create or replace function public.start_product_bom(
  p_sku           text,
  p_model         text,
  p_category_id   uuid    default null,
  p_new_category  text    default null,
  p_is_serialized boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sku      text := nullif(btrim(p_sku), '');
  v_model    text := nullif(btrim(p_model), '');
  v_category uuid := p_category_id;
  v_product  uuid;
  v_template uuid;
begin
  if v_sku is null or v_model is null then
    raise exception 'SKU code and model name are both required.';
  end if;

  if v_category is null and nullif(btrim(p_new_category), '') is not null then
    insert into public.categories (name, created_by)
    values (btrim(p_new_category), auth.uid())
    returning id into v_category;
  end if;

  insert into public.products (sku_code, model_name, category_id, is_serialized, created_by)
  values (v_sku, v_model, v_category, coalesce(p_is_serialized, true), auth.uid())
  returning id into v_product;

  insert into public.bom_templates (product_id, version, is_active, created_by)
  values (v_product, 1, true, auth.uid())
  returning id into v_template;

  return v_template;
end;
$$;

grant execute on function public.start_product_bom(text, text, uuid, text, boolean) to authenticated;
revoke execute on function public.start_product_bom(text, text, uuid, text, boolean) from anon, public;

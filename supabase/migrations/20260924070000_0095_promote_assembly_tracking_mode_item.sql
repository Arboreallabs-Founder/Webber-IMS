-- ============================================================
-- 0095 — promote_assembly_line(): sub-assemblies created here stay
-- tracking_mode='item' (per-piece QR), unlike the box-only tracking used
-- for regular purchased components. Restores the original behavior.
-- ============================================================

create or replace function public.promote_assembly_line(p_line uuid, p_component_no text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line   public.bom_template_lines%rowtype;
  v_name   text;
  v_cno    text;
  v_comp   uuid;
  v_subtpl uuid;
begin
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

  -- Move the folder's entire descendant subtree into the new sub-template.
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

  -- The folder line itself stays in the product template, now component-backed.
  update public.bom_template_lines
     set component_id = v_comp,
         quantity     = coalesce(nullif(quantity, 0), 1)
   where id = p_line;

  return v_comp;
end;
$$;

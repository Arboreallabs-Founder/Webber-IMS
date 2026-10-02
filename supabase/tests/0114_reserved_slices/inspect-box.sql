-- READ-ONLY. Paste a box's lot code (the one on its sticker) below to see
-- everything inside it: the box's own open stock and every reserved part,
-- with the project it's reserved for and its MPN split. Use it while
-- testing to check what the screens should be showing.
with box as (
  select id from public.inventory_lots where lot_code = 'LOT-PASTE-HERE'
)
select case when l.source_lot_id is null then 'BOX' else 'reserved part' end as kind,
       l.lot_code,
       l.status,
       p.project_no,
       l.qty_on_hand,
       l.qty_initial,
       l.location,
       (select string_agg(m.mpn || ' x ' || lm.qty, ', ')
          from public.inventory_lot_mpns lm join public.component_mpns m on m.id = lm.mpn_id
         where lm.lot_id = l.id) as mpns
  from public.inventory_lots l
  left join public.projects p on p.id = l.project_id
 where l.id = (select id from box) or l.source_lot_id = (select id from box)
 order by l.source_lot_id nulls first, l.created_at;

-- Block job-work over-receipt, the same way PO lines are blocked.
--
-- receive_job_work checked qty_returned, which only rises once the receipt is
-- processed — for an inspected component, after the IRN is approved. Until
-- then every new receipt saw 0 returned and passed, so one piece sent could
-- be received three times (JW/26-27/0036). The PO over-receipt trigger
-- already counts every GRN line entered, pending or not, but skipped
-- job-work lines. Both checks now count what's been entered against the
-- job-work line (or qty_returned, if that's higher) against qty_sent.

create or replace function public.grn_line_before_insert()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_ord  numeric;
  v_recv numeric;
begin
  if new.po_line_id is null and new.project_id is null then new.is_untagged := true; end if;

  if new.po_line_id is not null and new.jw_line_id is null then
    select qty_ordered into v_ord from public.po_lines where id = new.po_line_id;
    select coalesce(sum(qty_received), 0) into v_recv
      from public.grn_lines where po_line_id = new.po_line_id;

    if v_ord is not null and v_recv + new.qty_received > v_ord + 1e-6 then
      raise exception
        'Over-receipt blocked: PO line has % remaining (ordered %, already received %); this GRN line adds %.',
        (v_ord - v_recv), v_ord, v_recv, new.qty_received
        using errcode = 'check_violation';
    end if;
  end if;

  if new.jw_line_id is not null then
    select l.qty_sent,
           greatest(coalesce(l.qty_returned, 0),
                    coalesce((select sum(g.qty_received) from public.grn_lines g where g.jw_line_id = l.id), 0))
      into v_ord, v_recv
      from public.job_work_lines l where l.id = new.jw_line_id;

    if v_ord is not null and v_recv + new.qty_received > v_ord + 1e-6 then
      raise exception
        'Over-receipt blocked: job-work line has % remaining (sent %, already received or awaiting inspection %); this GRN line adds %.',
        greatest(v_ord - v_recv, 0), v_ord, v_recv, new.qty_received
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

-- receive_job_work: the friendly message, on the same count.
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.receive_job_work(uuid, uuid, numeric, uuid, jsonb, uuid)'::regprocedure);
  v_new := replace(v_def,
    $s$  if coalesce(v_line.qty_returned,0) + p_qty > v_line.qty_sent then
    return jsonb_build_object('error','Cannot receive more than was dispatched');
  end if;$s$,
    $s$  v_taken := greatest(coalesce(v_line.qty_returned, 0),
    coalesce((select sum(g.qty_received) from public.grn_lines g where g.jw_line_id = v_line.id), 0));
  if v_taken + p_qty > v_line.qty_sent + 1e-6 then
    return jsonb_build_object('error', format(
      'Only %s was sent to the vendor and %s is already received or awaiting inspection — %s left to receive. You entered %s.',
      v_line.qty_sent, v_taken, greatest(v_line.qty_sent - v_taken, 0), p_qty));
  end if;$s$);
  if v_new = v_def then raise exception 'receive_job_work: check pattern not found'; end if;
  v_new := replace(v_new, $s$  v_res     jsonb;$s$, $s$  v_res     jsonb;
  v_taken   numeric;$s$);
  execute v_new;
end $$;

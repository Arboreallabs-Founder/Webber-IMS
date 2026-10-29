-- ============================================================
-- 0102 — Every new PO is numbered YWSPL/<FY>/NNNN (e.g. YWSPL/26-27/0544).
--
-- next_po_no() used to hand out PO/<FY>/NNNN from seq_po_no, which nobody
-- actually used: the New PO dialog pre-filled it and users overwrote it by
-- hand, so live data holds a dozen shapes (YWSPL/26-27/542 alongside
-- YWSPL/26-27/0542, YWSPL/0535, YWSPL/26-27/04780, ...) and the same number
-- issued twice in different spellings.
--
-- From here on:
--   * The next number is the highest YWSPL/<current FY>/N (1–4 digits) in
--     use + 1 — counted from real POs, not a sequence, so a cancelled dialog
--     never burns a number, and it restarts at 0001 each April by itself.
--   * A new PO's number (or a renamed one) must be exactly
--     YWSPL/YY-YY/NNNN, with YY-YY a real consecutive year pair, and must
--     not collide numerically with any existing PO of that year — including
--     old unpadded spellings (0019 is taken if YWSPL/26-27/019 exists).
--   * Only an Admin may use a year other than the current FY (back-entering
--     old POs); the NNNN shape is the same for everyone.
--   * Existing POs keep their numbers. Revisions (root_po_id set) keep
--     <root>R<n>, and service-role scripts (historical imports) are exempt.
-- ============================================================

-- ---- the next free number for the current FY ------------------------------
create or replace function public.peek_next_po_no() returns text
  language sql stable security definer set search_path = public as $$
  select 'YWSPL/' || public.fiscal_year_label() || '/' || lpad((
    coalesce(max((regexp_match(po_no, '^YWSPL/' || public.fiscal_year_label() || '/([0-9]{1,4})$'))[1]::int), 0) + 1
  )::text, 4, '0')
  from public.purchase_orders
  where po_no ~ ('^YWSPL/' || public.fiscal_year_label() || '/[0-9]{1,4}$');
$$;
grant execute on function public.peek_next_po_no() to authenticated;

-- Same value as the preview: nothing is reserved until the PO row is
-- inserted. Two users racing for the same number are caught by the unique
-- po_no constraint, and the app retries with a fresh one.
create or replace function public.next_po_no() returns text
  language sql stable security definer set search_path = public as $$
  select public.peek_next_po_no();
$$;
grant execute on function public.next_po_no() to authenticated;

-- ---- format + duplicate guard on create / rename --------------------------
create or replace function public.purchase_order_check_po_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m     text[];
  v_fy  text;
  v_n   int;
begin
  -- Revisions derive their number from the root; scripts run as the service
  -- role (no auth.uid()) load historical numbers as-is.
  if new.root_po_id is not null or auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.po_no is not distinct from old.po_no then
    return new;
  end if;

  m := regexp_match(new.po_no, '^YWSPL/([0-9]{2})-([0-9]{2})/([0-9]{4})$');
  if m is null then
    raise exception 'PO number must be in the format YWSPL/%/0001 — "YWSPL/", the financial year, "/", then exactly 4 digits.', public.fiscal_year_label()
      using errcode = 'check_violation';
  end if;

  if (m[1]::int + 1) % 100 <> m[2]::int then
    raise exception '"%-%" is not a financial year — it should look like %.', m[1], m[2], public.fiscal_year_label()
      using errcode = 'check_violation';
  end if;

  v_fy := m[1] || '-' || m[2];
  if v_fy <> public.fiscal_year_label() and public.auth_role() is distinct from 'admin' then
    raise exception 'The year must be % — only an Admin can raise a PO under a different year.', public.fiscal_year_label()
      using errcode = 'check_violation';
  end if;

  v_n := m[3]::int;
  if v_n = 0 then
    raise exception 'PO number can''t be 0000 — numbering starts at 0001.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.purchase_orders
     where id <> new.id
       and po_no ~ ('^YWSPL/' || v_fy || '/0*' || v_n || '$')
  ) then
    raise exception 'PO number YWSPL/%/% is already used (possibly in an older spelling).', v_fy, m[3]
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;
revoke all on function public.purchase_order_check_po_no() from public, anon;

drop trigger if exists purchase_order_check_po_no on public.purchase_orders;
create trigger purchase_order_check_po_no
  before insert or update of po_no on public.purchase_orders
  for each row execute function public.purchase_order_check_po_no();

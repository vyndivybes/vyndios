-- Permit atomic journal construction within its posting transaction, then seal it.
-- Existing UPDATE/DELETE immutability and hard-close triggers remain authoritative.
create or replace function guard_vyndi_posted_journal_line_insert() returns trigger
language plpgsql as $$
declare v_status text; v_xid text;
begin
  select status,xmin::text into v_status,v_xid from epr_finance_journals where id=new.journal_id for key share;
  if v_status='posted' and v_xid<>(pg_current_xact_id()::text::numeric % 4294967296)::text then
    raise exception 'Lines of a posted finance journal are immutable. Use a linked reversal journal.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vyndi_posted_journal_no_late_insert on epr_finance_journal_lines;
create trigger trg_vyndi_posted_journal_no_late_insert
before insert on epr_finance_journal_lines for each row execute function guard_vyndi_posted_journal_line_insert();

create or replace function check_vyndi_posted_journal_balance() returns trigger
language plpgsql as $$
declare v_id text; v_count bigint; v_debit numeric; v_credit numeric;
begin
  if tg_table_name='epr_finance_journals' then
    v_id:=coalesce(new.id,old.id);
  else
    v_id:=coalesce(new.journal_id,old.journal_id);
  end if;
  if exists(select 1 from epr_finance_journals where id=v_id and status='posted') then
    select count(*),coalesce(sum(debit_inr),0),coalesce(sum(credit_inr),0)
      into v_count,v_debit,v_credit from epr_finance_journal_lines where journal_id=v_id;
    if v_count<2 or v_debit<>v_credit or v_debit*100>9007199254740991 or v_credit*100>9007199254740991 then
      raise exception 'Posted finance journal % is not balanced in safe paise at transaction commit.',v_id;
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_vyndi_posted_journal_header_balance on epr_finance_journals;
create constraint trigger trg_vyndi_posted_journal_header_balance
after insert or update on epr_finance_journals deferrable initially deferred
for each row execute function check_vyndi_posted_journal_balance();
drop trigger if exists trg_vyndi_posted_journal_line_balance on epr_finance_journal_lines;
create constraint trigger trg_vyndi_posted_journal_line_balance
after insert or update or delete on epr_finance_journal_lines deferrable initially deferred
for each row execute function check_vyndi_posted_journal_balance();

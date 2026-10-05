-- Deterministic append order for inventory stocktake audit events.
-- created_at can legitimately tie at transaction timestamp precision; random event ids
-- must never be used as a chronological tiebreaker.

alter table epr_inventory_stocktake_events
  add column if not exists event_seq bigserial;

alter table epr_inventory_stocktake_events
  alter column event_seq set not null;

create unique index if not exists epr_inventory_stocktake_events_seq_uidx
  on epr_inventory_stocktake_events(event_seq);

create index if not exists epr_inventory_stocktake_events_stocktake_seq_idx
  on epr_inventory_stocktake_events(stocktake_id,event_seq);

-- VAOS signed bridge replay protection for read commissioning.
create table if not exists vyndi_vaos_bridge_nonces (
  nonce text primary key,
  key_id text not null,
  body_sha256 text not null,
  action_type text not null,
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint vyndi_vaos_bridge_nonces_sha_check check (body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vyndi_vaos_bridge_nonces_expiry_check check (expires_at > received_at)
);

create index if not exists vyndi_vaos_bridge_nonces_expiry_idx
  on vyndi_vaos_bridge_nonces(expires_at);

comment on table vyndi_vaos_bridge_nonces is
  'Replay-protection ledger for cryptographically signed VAOS service requests.';

create or replace function claim_vyndi_vaos_bridge_nonce(
  p_nonce text,
  p_key_id text,
  p_body_sha256 text,
  p_action_type text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
as $$
declare
  v_inserted text;
begin
  delete from vyndi_vaos_bridge_nonces where expires_at < now() - interval '5 minutes';

  insert into vyndi_vaos_bridge_nonces(nonce,key_id,body_sha256,action_type,expires_at)
  values(trim(p_nonce),trim(p_key_id),lower(trim(p_body_sha256)),trim(p_action_type),p_expires_at)
  on conflict (nonce) do nothing
  returning nonce into v_inserted;

  return v_inserted is not null;
end;
$$;

comment on function claim_vyndi_vaos_bridge_nonce(text,text,text,text,timestamptz) is
  'Claims a verified VAOS bridge nonce exactly once. Signature verification happens in the Worker before this function is called.';

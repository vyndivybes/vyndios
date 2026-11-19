-- Recovery P1: replace timestamp-based event identity, not event history.
-- CI reproduced SQLSTATE 23505 duplicate vyndi_recovery_events primary key:
-- identical payload dimensions + clock_timestamp() are not unique.
-- This migration is intentionally independent of draft A01 0196-0198.
-- Do NOT change append-only triggers, ACL/RLS, existing IDs, or business rows.
-- PostgreSQL 13+ pg_catalog.gen_random_uuid() is built in; no extension/grant.
CREATE OR REPLACE FUNCTION append_vyndi_recovery_event(
  p_request_id text,
  p_checkpoint_id text,
  p_event_type text,
  p_actor_user_id text,
  p_actor_role text,
  p_evidence_reference text,
  p_payload_json jsonb
) RETURNS text
LANGUAGE plpgsql AS $recovery_event_uuid$
DECLARE
  v_id text;
BEGIN
  -- Preserve the legacy REC-EVT- + 32 lowercase hexadecimal external shape.
  -- UUID4 random collision resistance does not depend on SQL clock precision.
  v_id := 'REC-EVT-' || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  INSERT INTO vyndi_recovery_events
    (id,request_id,checkpoint_id,event_type,actor_user_id,actor_role,evidence_reference,payload_json)
  VALUES
    (v_id,p_request_id,p_checkpoint_id,trim(p_event_type),p_actor_user_id,p_actor_role,
     trim(coalesce(p_evidence_reference,'')),coalesce(p_payload_json,'{}'::jsonb));
  RETURN v_id;
END;
$recovery_event_uuid$;

COMMENT ON FUNCTION append_vyndi_recovery_event(text,text,text,text,text,text,jsonb) IS
  'Collision-resistant, append-only recovery audit event ID. Preserves legacy IDs and existing maker/checker evidence. No extra grants or changes to recovery policy.';

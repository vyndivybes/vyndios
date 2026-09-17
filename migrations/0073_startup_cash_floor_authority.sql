-- Correct startup cash-reserve governance.
--
-- The previous approved operating plan used cashFloorLakh=15, identical to the
-- entire T1 Foundation tranche. With a verified ₹15L bank balance, any normal
-- startup spend immediately produced negative "free liquidity" even though the
-- business still had substantial cash. T1 is deployable working capital, not a
-- fully restricted reserve.
--
-- This migration creates a new immutable approved plan revision with a ₹3L
-- startup operating reserve. It preserves every other approved-plan assumption,
-- supersedes the previous revision, and records auditable lineage.

DO $$
DECLARE
  v_old vyndi_plan_revisions%ROWTYPE;
  v_new_id text := 'PLAN-STARTUP-RESERVE-3L';
  v_new_revision integer;
  v_new_finance jsonb;
BEGIN
  SELECT * INTO v_old
    FROM vyndi_plan_revisions
   WHERE status='approved'
   ORDER BY revision DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'No approved operating plan exists; startup reserve migration skipped.';
    RETURN;
  END IF;

  IF COALESCE((v_old.finance_json #>> '{operatingPlan,cashFloorLakh}')::numeric, 0) = 3 THEN
    RAISE NOTICE 'Approved operating plan already uses ₹3L startup reserve; no change required.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM vyndi_plan_revisions WHERE id=v_new_id) THEN
    RAISE NOTICE 'Startup reserve plan revision already exists; no change required.';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('approved-operating-plan')::bigint);
  PERFORM pg_advisory_xact_lock(hashtext('vyndi-plan-revision-sequence')::bigint);
  SELECT COALESCE(MAX(revision),0)+1 INTO v_new_revision FROM vyndi_plan_revisions;

  v_new_finance := jsonb_set(v_old.finance_json, '{operatingPlan,cashFloorLakh}', '3'::jsonb, true);
  v_new_finance := jsonb_set(
    v_new_finance,
    '{operatingPlan,note}',
    to_jsonb('Startup operating reserve is ₹3L. The ₹15L Foundation tranche remains deployable working capital; baseline commercial launch remains unchanged.'::text),
    true
  );

  UPDATE vyndi_plan_revisions
     SET status='superseded'
   WHERE id=v_old.id AND status='approved';

  INSERT INTO vyndi_plan_revisions (
    id,revision,status,horizon_months,scenario,draw_standby,finance_json,accounting_json,
    change_reason,created_by,created_at,submitted_by,submitted_at,approved_by,approved_at,supersedes_id
  ) VALUES (
    v_new_id,v_new_revision,'approved',v_old.horizon_months,v_old.scenario,v_old.draw_standby,
    v_new_finance,v_old.accounting_json,
    'Correct startup reserve policy: ₹15L T1 is working capital; minimum operating reserve set to ₹3L.',
    'system-migration:0073',now(),'system-migration:0073',now(),'system-migration:0073',now(),v_old.id
  );

  INSERT INTO vyndi_audit_events (
    id,entity_type,entity_id,entity_revision,action,actor_user_id,actor_role,source_reference,
    payload_json,correlation_id,gate_id,gate_result,previous_state,new_state,reason
  ) VALUES (
    'AUD-PLAN-STARTUP-RESERVE-3L','operating_plan',v_new_id,v_new_revision,
    'approved','system-migration:0073','system',v_old.id,
    jsonb_build_object(
      'previousCashFloorLakh',v_old.finance_json #>> '{operatingPlan,cashFloorLakh}',
      'newCashFloorLakh',3,
      't1FoundationLakh',15,
      'policy','T1 working capital is deployable; reserve is separate'
    ),
    'STARTUP-CASH-RESERVE-POLICY','IBPE-CASH-RESERVE','pass','approved','approved',
    'Corrected reserve policy so startup operating cash is usable while retaining a ₹3L safety reserve.'
  ) ON CONFLICT (id) DO NOTHING;
END $$;

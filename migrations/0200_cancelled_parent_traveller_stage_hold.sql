-- P0 containment: existing cancelled job cards may retain audit-linked WIP.
-- Never repair historical status/stock rows in this migration. Guard all future
-- forward status changes (and post-release parent relinking) transactionally.
CREATE OR REPLACE FUNCTION public.guard_cancelled_parent_traveller_stage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_id text;
  v_parent_status text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NULLIF(btrim(OLD.job_card_id),'') IS NOT NULL
       AND OLD.status IN ('released','in_build','completed')
       AND NEW.job_card_id IS DISTINCT FROM OLD.job_card_id
    THEN
      RAISE EXCEPTION 'Controlled traveller lineage cannot be relinked after release.';
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A safe containment/quality HOLD or rejected disposition is permitted;
  -- only productive forward states require active job-card authority.
  IF NEW.status NOT IN ('released','in_build','completed') THEN
    RETURN NEW;
  END IF;
  v_parent_id := NULLIF(btrim(NEW.job_card_id),'');
  IF v_parent_id IS NULL THEN
    RETURN NEW; -- Legacy non-job-card travellers use their own gates.
  END IF;

  -- FOR SHARE conflicts with a concurrent parent status UPDATE, so this
  -- decision is made against a locked, transactionally consistent parent.
  SELECT jc.status INTO v_parent_status
    FROM public.epr_production_job_cards jc
   WHERE jc.id = v_parent_id
   FOR SHARE;
  IF v_parent_status IS NULL OR v_parent_status NOT IN ('released','in_progress') THEN
    RAISE EXCEPTION 'Linked parent job card cancelled or not released: traveller forward release HOLD.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_cancelled_parent_traveller_stage
  ON public.epr_travellers;
CREATE TRIGGER trg_guard_cancelled_parent_traveller_stage
BEFORE INSERT OR UPDATE OF status,job_card_id
ON public.epr_travellers
FOR EACH ROW
EXECUTE FUNCTION public.guard_cancelled_parent_traveller_stage();

-- Audit trail of every emergency lifecycle change.
CREATE TABLE IF NOT EXISTS public.emergency_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
  owner_id uuid,
  previous_phase text,
  new_phase text,
  previous_status text,
  new_status text,
  actor_id uuid,
  source text NOT NULL DEFAULT 'unknown',
  reason text,
  request_id text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.emergency_transitions TO authenticated;
GRANT ALL ON public.emergency_transitions TO service_role;
ALTER TABLE public.emergency_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owners read own transitions" ON public.emergency_transitions;
CREATE POLICY "Owners read own transitions" ON public.emergency_transitions
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "Admins read transitions" ON public.emergency_transitions;
CREATE POLICY "Admins read transitions" ON public.emergency_transitions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS emergency_transitions_em_idx ON public.emergency_transitions (emergency_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS emergency_transitions_request_uidx
  ON public.emergency_transitions (emergency_id, request_id) WHERE request_id IS NOT NULL;

-- Browser sessions may not change lifecycle fields directly or reopen closed sessions.
CREATE OR REPLACE FUNCTION public.guard_emergency_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status IN ('resolved','cancelled') AND NEW.status NOT IN ('resolved','cancelled') THEN
    RAISE EXCEPTION 'A closed emergency cannot be reopened';
  END IF;
  IF OLD.phase IN ('resolved','cancelled','failed','expired') AND NEW.phase IS DISTINCT FROM OLD.phase THEN
    RAISE EXCEPTION 'A closed emergency cannot change phase';
  END IF;
  IF current_user IN ('authenticated','anon') AND (
       NEW.phase IS DISTINCT FROM OLD.phase
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.resolution_status IS DISTINCT FROM OLD.resolution_status) THEN
    RAISE EXCEPTION 'Emergency status changes must go through transition_emergency';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS emergencies_guard_lifecycle ON public.emergencies;
CREATE TRIGGER emergencies_guard_lifecycle BEFORE UPDATE ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.guard_emergency_lifecycle();

-- Every phase/status change (from any server path) is recorded.
CREATE OR REPLACE FUNCTION public.log_emergency_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.phase IS NOT DISTINCT FROM OLD.phase
     AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.emergency_transitions
    (emergency_id, owner_id, previous_phase, new_phase, previous_status, new_status,
     actor_id, source, reason, request_id)
  VALUES (NEW.id, NEW.user_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.phase END, NEW.phase,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
    auth.uid(),
    COALESCE(NULLIF(current_setting('resqora.source', true), ''), CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'server' END),
    NULLIF(current_setting('resqora.reason', true), ''),
    NULLIF(current_setting('resqora.request_id', true), ''));
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.log_emergency_transition() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS emergencies_log_transition ON public.emergencies;
CREATE TRIGGER emergencies_log_transition AFTER INSERT OR UPDATE OF phase, status ON public.emergencies
  FOR EACH ROW EXECUTE FUNCTION public.log_emergency_transition();

-- Transition RPC gains an optional request ID: repeating it returns the first result.
DROP FUNCTION IF EXISTS public.transition_emergency(uuid, text, text);
CREATE OR REPLACE FUNCTION public.transition_emergency(_emergency_id uuid, _to_phase text, _note text DEFAULT NULL, _request_id text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  is_admin boolean;
  from_rank integer;
  to_rank integer;
  actor text;
  prior jsonb;
  res jsonb;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _request_id IS NOT NULL AND length(_request_id) > 100 THEN RAISE EXCEPTION 'Invalid request id'; END IF;

  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id FOR UPDATE;
  IF em.id IS NULL THEN RAISE EXCEPTION 'Emergency not found'; END IF;

  is_admin := public.has_role(caller, 'admin');
  IF em.user_id IS DISTINCT FROM caller AND NOT is_admin THEN
    RAISE EXCEPTION 'Not authorised for this emergency';
  END IF;

  IF _request_id IS NOT NULL THEN
    SELECT result INTO prior FROM public.emergency_transitions
      WHERE emergency_id = em.id AND request_id = _request_id AND result IS NOT NULL LIMIT 1;
    IF prior IS NOT NULL THEN RETURN prior || jsonb_build_object('replayed', true); END IF;
  END IF;

  IF em.phase IN ('resolved', 'cancelled', 'failed', 'expired') THEN
    RETURN jsonb_build_object('changed', false, 'phase', em.phase, 'reason', 'closed');
  END IF;

  IF _to_phase IN ('cancelled', 'failed', 'expired') THEN
    to_rank := NULL;
  ELSE
    to_rank := public.emergency_phase_rank(_to_phase);
    IF to_rank IS NULL THEN RAISE EXCEPTION 'Unknown emergency phase: %', _to_phase; END IF;
    from_rank := public.emergency_phase_rank(em.phase);
    IF to_rank <= COALESCE(from_rank, -1) THEN
      RETURN jsonb_build_object('changed', false, 'phase', em.phase, 'reason', 'not_forward');
    END IF;
  END IF;

  actor := CASE WHEN em.user_id = caller THEN 'owner' ELSE 'command_center' END;
  PERFORM set_config('resqora.source', actor, true);
  PERFORM set_config('resqora.reason', COALESCE(left(_note, 300), ''), true);
  PERFORM set_config('resqora.request_id', COALESCE(_request_id, ''), true);

  UPDATE public.emergencies SET
    phase = _to_phase,
    phase_updated_at = now(),
    status = CASE
      WHEN _to_phase = 'resolved' THEN 'resolved'
      WHEN _to_phase IN ('cancelled', 'failed', 'expired') THEN 'cancelled'
      ELSE 'active' END,
    live_status = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired') THEN 'safe' ELSE live_status END,
    resolution_status = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired')
      THEN _to_phase ELSE resolution_status END,
    resolved_at = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired')
      THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
    duration_seconds = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired')
      THEN COALESCE(duration_seconds, GREATEST(1, EXTRACT(EPOCH FROM (now() - started_at))::int)) ELSE duration_seconds END,
    responder_status = CASE
      WHEN _to_phase = 'dispatched' THEN 'dispatched'
      WHEN _to_phase = 'en_route' THEN 'en_route'
      WHEN _to_phase = 'arrived' THEN 'on_scene'
      WHEN _to_phase = 'resolved' THEN 'released'
      ELSE responder_status END,
    hospital_status = CASE
      WHEN _to_phase = 'patient_transfer' THEN 'en_route'
      WHEN _to_phase = 'hospital_handoff' THEN 'transferred'
      ELSE hospital_status END
  WHERE id = em.id;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (em.id, em.user_id, 'Phase: ' || _to_phase,
          COALESCE(left(_note, 300), 'Updated by ' || actor));

  res := jsonb_build_object('changed', true, 'phase', _to_phase, 'actor', actor);
  UPDATE public.emergency_transitions SET result = res
    WHERE id = (SELECT id FROM public.emergency_transitions
                WHERE emergency_id = em.id ORDER BY created_at DESC LIMIT 1);
  PERFORM set_config('resqora.source', '', true);
  PERFORM set_config('resqora.reason', '', true);
  PERFORM set_config('resqora.request_id', '', true);
  RETURN res;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.transition_emergency(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_emergency(uuid, text, text, text) TO authenticated;
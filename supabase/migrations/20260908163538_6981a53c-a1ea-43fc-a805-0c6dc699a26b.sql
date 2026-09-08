-- 1. Extend the central emergency record
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS public_code text,
  ADD COLUMN IF NOT EXISTS incident_type text NOT NULL DEFAULT 'medical',
  ADD COLUMN IF NOT EXISTS incident_description text,
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS phase_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS responder_status text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS hospital_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS victim_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS location_accuracy double precision,
  ADD COLUMN IF NOT EXISTS connectivity_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS is_mass_casualty boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_simulation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE public.emergencies
   SET public_code = upper(substring(replace(id::text, '-', ''), 1, 10))
 WHERE public_code IS NULL;

ALTER TABLE public.emergencies
  ALTER COLUMN public_code SET DEFAULT upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 10));

CREATE UNIQUE INDEX IF NOT EXISTS emergencies_public_code_key ON public.emergencies (public_code);
CREATE UNIQUE INDEX IF NOT EXISTS emergencies_idempotency_key_uidx
  ON public.emergencies (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS emergencies_phase_idx ON public.emergencies (phase, created_at DESC);
CREATE INDEX IF NOT EXISTS emergencies_sim_idx ON public.emergencies (is_simulation, created_at DESC);

-- Backfill phase from legacy status for existing rows
UPDATE public.emergencies
   SET phase = CASE
     WHEN status = 'resolved' THEN 'resolved'
     WHEN status = 'cancelled' THEN 'cancelled'
     WHEN status = 'created' THEN 'activated'
     ELSE 'activated'
   END
 WHERE phase = 'draft';

-- 2. People involved in an incident (mass-casualty support)
CREATE TABLE IF NOT EXISTS public.emergency_victims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  label text NOT NULL,
  priority text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'reported',
  notes text,
  assigned_responder text,
  hospital text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_victims TO authenticated;
GRANT ALL ON public.emergency_victims TO service_role;
ALTER TABLE public.emergency_victims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage people in their incidents"
  ON public.emergency_victims FOR ALL TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS emergency_victims_emergency_idx
  ON public.emergency_victims (emergency_id, created_at);

CREATE TRIGGER emergency_victims_updated_at
  BEFORE UPDATE ON public.emergency_victims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Server-authorised lifecycle transitions
CREATE OR REPLACE FUNCTION public.emergency_phase_rank(_phase text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _phase
    WHEN 'draft' THEN 0
    WHEN 'activated' THEN 1
    WHEN 'assessing' THEN 2
    WHEN 'alerting' THEN 3
    WHEN 'acknowledged' THEN 4
    WHEN 'dispatched' THEN 5
    WHEN 'en_route' THEN 6
    WHEN 'arrived' THEN 7
    WHEN 'patient_transfer' THEN 8
    WHEN 'hospital_handoff' THEN 9
    WHEN 'recovery' THEN 10
    WHEN 'resolved' THEN 11
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.transition_emergency(
  _emergency_id uuid,
  _to_phase text,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  is_admin boolean;
  from_rank integer;
  to_rank integer;
  actor text;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id FOR UPDATE;
  IF em.id IS NULL THEN RAISE EXCEPTION 'Emergency not found'; END IF;

  is_admin := public.has_role(caller, 'admin');
  IF em.user_id <> caller AND NOT is_admin THEN
    RAISE EXCEPTION 'Not authorised for this emergency';
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

  UPDATE public.emergencies SET
    phase = _to_phase,
    phase_updated_at = now(),
    status = CASE
      WHEN _to_phase = 'resolved' THEN 'resolved'
      WHEN _to_phase = 'cancelled' THEN 'cancelled'
      WHEN _to_phase IN ('failed', 'expired') THEN 'cancelled'
      ELSE 'active' END,
    resolution_status = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired')
      THEN _to_phase ELSE resolution_status END,
    resolved_at = CASE WHEN _to_phase IN ('resolved','cancelled','failed','expired')
      THEN COALESCE(resolved_at, now()) ELSE resolved_at END,
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

  RETURN jsonb_build_object('changed', true, 'phase', _to_phase, 'actor', actor);
END; $$;

REVOKE EXECUTE ON FUNCTION public.transition_emergency(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_emergency(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.emergency_phase_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emergency_phase_rank(text) TO authenticated;
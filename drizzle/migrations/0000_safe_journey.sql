-- ============================================================
-- SAFE JOURNEY
-- Everyday travel monitoring built on the existing RESQORA
-- accounts, emergency contacts and emergency-session model.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.safe_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guardian_contact_id uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  guardian_name text NOT NULL,
  guardian_phone text,
  guardian_email text,
  name text NOT NULL,
  origin_latitude double precision,
  origin_longitude double precision,
  origin_address text,
  destination_latitude double precision,
  destination_longitude double precision,
  destination_address text NOT NULL,
  expected_arrival_at timestamptz NOT NULL,
  check_in_interval_minutes integer,
  grace_period_minutes integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'planned',
  sharing_enabled boolean NOT NULL DEFAULT true,
  notify_guardian_on_start boolean NOT NULL DEFAULT true,
  notify_guardian_on_complete boolean NOT NULL DEFAULT true,
  notify_guardian_on_missed boolean NOT NULL DEFAULT true,
  emergency_id uuid REFERENCES public.emergencies(id) ON DELETE SET NULL,
  check_in_required_at timestamptz,
  last_check_in_at timestamptz,
  guardian_notified_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  last_location_at timestamptz,
  last_latitude double precision,
  last_longitude double precision,
  last_accuracy double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safe_journeys TO authenticated;
GRANT ALL ON public.safe_journeys TO service_role;
ALTER TABLE public.safe_journeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own journeys" ON public.safe_journeys;
CREATE POLICY "Own journeys" ON public.safe_journeys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS safe_journeys_user_status_idx
  ON public.safe_journeys (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS safe_journeys_guardian_email_idx
  ON public.safe_journeys (guardian_email);

-- Only one journey may be live at a time per account.
CREATE UNIQUE INDEX IF NOT EXISTS safe_journeys_one_live_per_user
  ON public.safe_journeys (user_id)
  WHERE status IN ('planned','active','arriving','check_in_required','check_in_missed','guardian_notified','emergency_escalated');

DROP TRIGGER IF EXISTS safe_journeys_updated_at ON public.safe_journeys;
CREATE TRIGGER safe_journeys_updated_at
  BEFORE UPDATE ON public.safe_journeys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------- journey timeline ----------------
CREATE TABLE IF NOT EXISTS public.safe_journey_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.safe_journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  label text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.safe_journey_events TO authenticated;
GRANT ALL ON public.safe_journey_events TO service_role;
ALTER TABLE public.safe_journey_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own journey events" ON public.safe_journey_events;
CREATE POLICY "Own journey events" ON public.safe_journey_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS safe_journey_events_journey_idx
  ON public.safe_journey_events (journey_id, created_at);

-- ---------------- notification ledger (idempotent) ----------------
CREATE TABLE IF NOT EXISTS public.safe_journey_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES public.safe_journeys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  channel text NOT NULL,
  recipient_label text NOT NULL,
  recipient_contact_id uuid,
  status text NOT NULL DEFAULT 'queued',
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.safe_journey_notifications TO authenticated;
GRANT ALL ON public.safe_journey_notifications TO service_role;
ALTER TABLE public.safe_journey_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own journey notifications" ON public.safe_journey_notifications;
CREATE POLICY "Own journey notifications" ON public.safe_journey_notifications
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Retries reuse the same row instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS safe_journey_notifications_unique
  ON public.safe_journey_notifications (journey_id, event_type, channel, recipient_label);

DROP TRIGGER IF EXISTS safe_journey_notifications_updated_at ON public.safe_journey_notifications;
CREATE TRIGGER safe_journey_notifications_updated_at
  BEFORE UPDATE ON public.safe_journey_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------- safety circle (settings over existing contacts) ----------------
CREATE TABLE IF NOT EXISTS public.safety_circle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.emergency_contacts(id) ON DELETE CASCADE,
  is_default_guardian boolean NOT NULL DEFAULT false,
  notify_on_start boolean NOT NULL DEFAULT true,
  notify_on_complete boolean NOT NULL DEFAULT true,
  notify_on_missed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_circle_members TO authenticated;
GRANT ALL ON public.safety_circle_members TO service_role;
ALTER TABLE public.safety_circle_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own safety circle" ON public.safety_circle_members;
CREATE POLICY "Own safety circle" ON public.safety_circle_members
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS safety_circle_members_updated_at ON public.safety_circle_members;
CREATE TRIGGER safety_circle_members_updated_at
  BEFORE UPDATE ON public.safety_circle_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- STATE MACHINE
-- ============================================================
CREATE OR REPLACE FUNCTION public.safe_journey_live_statuses()
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['planned','active','arriving','check_in_required','check_in_missed','guardian_notified','emergency_escalated']::text[]
$$;

CREATE OR REPLACE FUNCTION public.safe_journey_can_transition(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _from
    WHEN 'planned' THEN _to IN ('active','cancelled')
    WHEN 'active' THEN _to IN ('arriving','check_in_required','completed','cancelled','emergency_escalated')
    WHEN 'arriving' THEN _to IN ('active','check_in_required','completed','cancelled','emergency_escalated')
    WHEN 'check_in_required' THEN _to IN ('active','arriving','check_in_missed','completed','cancelled','emergency_escalated')
    WHEN 'check_in_missed' THEN _to IN ('guardian_notified','active','completed','cancelled','emergency_escalated')
    WHEN 'guardian_notified' THEN _to IN ('active','completed','cancelled','emergency_escalated')
    WHEN 'emergency_escalated' THEN _to IN ('completed','cancelled')
    ELSE false
  END
$$;

-- Creates a journey in ACTIVE state. Validates ownership of the chosen
-- guardian contact and refuses a second live journey.
CREATE OR REPLACE FUNCTION public.start_safe_journey(_payload jsonb)
RETURNS public.safe_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _contact public.emergency_contacts;
  _row public.safe_journeys;
  _arrival timestamptz;
  _grace integer;
  _interval integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.safe_journeys
    WHERE user_id = _uid AND status = ANY (public.safe_journey_live_statuses())
  ) THEN
    RAISE EXCEPTION 'A Safe Journey is already running. End it before starting another.';
  END IF;

  SELECT * INTO _contact FROM public.emergency_contacts
  WHERE id = (_payload->>'guardian_contact_id')::uuid AND user_id = _uid;
  IF _contact.id IS NULL THEN
    RAISE EXCEPTION 'Select one of your own emergency contacts as the journey guardian.';
  END IF;

  _arrival := (_payload->>'expected_arrival_at')::timestamptz;
  IF _arrival IS NULL OR _arrival <= now() THEN
    RAISE EXCEPTION 'Expected arrival time must be in the future.';
  END IF;
  IF _arrival > now() + interval '24 hours' THEN
    RAISE EXCEPTION 'Expected arrival must be within the next 24 hours.';
  END IF;

  _grace := COALESCE((_payload->>'grace_period_minutes')::integer, 10);
  IF _grace NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION 'Grace period must be between 5 and 60 minutes.';
  END IF;

  _interval := NULLIF(_payload->>'check_in_interval_minutes','')::integer;
  IF _interval IS NOT NULL AND _interval NOT BETWEEN 10 AND 180 THEN
    RAISE EXCEPTION 'Check-in interval must be between 10 and 180 minutes.';
  END IF;

  IF COALESCE(btrim(_payload->>'destination_address'),'') = '' THEN
    RAISE EXCEPTION 'A destination is required.';
  END IF;

  INSERT INTO public.safe_journeys (
    user_id, guardian_contact_id, guardian_name, guardian_phone, guardian_email,
    name, origin_latitude, origin_longitude, origin_address,
    destination_latitude, destination_longitude, destination_address,
    expected_arrival_at, check_in_interval_minutes, grace_period_minutes,
    status, sharing_enabled,
    notify_guardian_on_start, notify_guardian_on_complete, notify_guardian_on_missed,
    started_at, last_latitude, last_longitude, last_accuracy, last_location_at
  ) VALUES (
    _uid, _contact.id, _contact.name, _contact.phone, lower(NULLIF(btrim(COALESCE(_contact.email,'')),'')),
    COALESCE(NULLIF(btrim(_payload->>'name'),''), 'Safe Journey'),
    NULLIF(_payload->>'origin_latitude','')::double precision,
    NULLIF(_payload->>'origin_longitude','')::double precision,
    NULLIF(btrim(COALESCE(_payload->>'origin_address','')),''),
    NULLIF(_payload->>'destination_latitude','')::double precision,
    NULLIF(_payload->>'destination_longitude','')::double precision,
    btrim(_payload->>'destination_address'),
    _arrival, _interval, _grace,
    'active', COALESCE((_payload->>'sharing_enabled')::boolean, true),
    COALESCE((_payload->>'notify_guardian_on_start')::boolean, true),
    COALESCE((_payload->>'notify_guardian_on_complete')::boolean, true),
    COALESCE((_payload->>'notify_guardian_on_missed')::boolean, true),
    now(),
    NULLIF(_payload->>'origin_latitude','')::double precision,
    NULLIF(_payload->>'origin_longitude','')::double precision,
    NULLIF(_payload->>'last_accuracy','')::double precision,
    CASE WHEN NULLIF(_payload->>'origin_latitude','') IS NULL THEN NULL ELSE now() END
  )
  RETURNING * INTO _row;

  INSERT INTO public.safe_journey_events (journey_id, user_id, label, detail)
  VALUES (_row.id, _uid, 'Journey started',
    format('%s → %s, expected by %s. Guardian: %s.', COALESCE(_row.origin_address,'current location'),
           _row.destination_address, to_char(_row.expected_arrival_at,'DD Mon HH24:MI'), _row.guardian_name));

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.start_safe_journey(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_safe_journey(jsonb) TO authenticated;

-- Server-authoritative status change.
CREATE OR REPLACE FUNCTION public.safe_journey_transition(_journey_id uuid, _to text, _note text DEFAULT NULL)
RETURNS public.safe_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.safe_journeys;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO _row FROM public.safe_journeys
  WHERE id = _journey_id AND user_id = _uid FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Journey not found'; END IF;

  IF _row.status = _to THEN RETURN _row; END IF;

  IF NOT public.safe_journey_can_transition(_row.status, _to) THEN
    RAISE EXCEPTION 'Cannot move a journey from % to %.', _row.status, _to;
  END IF;

  UPDATE public.safe_journeys SET
    status = _to,
    check_in_required_at = CASE WHEN _to = 'check_in_required' THEN COALESCE(check_in_required_at, now()) ELSE check_in_required_at END,
    last_check_in_at = CASE WHEN _to IN ('active','arriving','completed') THEN now() ELSE last_check_in_at END,
    guardian_notified_at = CASE WHEN _to = 'guardian_notified' THEN COALESCE(guardian_notified_at, now()) ELSE guardian_notified_at END,
    completed_at = CASE WHEN _to = 'completed' THEN now() ELSE completed_at END,
    cancelled_at = CASE WHEN _to = 'cancelled' THEN now() ELSE cancelled_at END
  WHERE id = _row.id
  RETURNING * INTO _row;

  INSERT INTO public.safe_journey_events (journey_id, user_id, label, detail)
  VALUES (_row.id, _uid, 'Status: ' || replace(_to, '_', ' '), _note);

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_journey_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_journey_transition(uuid, text, text) TO authenticated;

-- Stores the newest real device fix. Refuses writes once the journey is over,
-- so tracking genuinely stops at completion.
CREATE OR REPLACE FUNCTION public.safe_journey_location(
  _journey_id uuid, _latitude double precision, _longitude double precision,
  _accuracy double precision DEFAULT NULL, _captured_at timestamptz DEFAULT now()
) RETURNS public.safe_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.safe_journeys;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _latitude IS NULL OR _longitude IS NULL THEN RAISE EXCEPTION 'Coordinates required'; END IF;

  SELECT * INTO _row FROM public.safe_journeys
  WHERE id = _journey_id AND user_id = _uid FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Journey not found'; END IF;
  IF NOT (_row.status = ANY (public.safe_journey_live_statuses())) THEN
    RAISE EXCEPTION 'This journey has ended.';
  END IF;
  IF NOT _row.sharing_enabled THEN RETURN _row; END IF;

  -- An out-of-order fix never overwrites a newer one.
  IF _row.last_location_at IS NOT NULL AND _captured_at <= _row.last_location_at THEN
    RETURN _row;
  END IF;

  UPDATE public.safe_journeys SET
    last_latitude = _latitude, last_longitude = _longitude,
    last_accuracy = _accuracy, last_location_at = _captured_at
  WHERE id = _row.id RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_journey_location(uuid, double precision, double precision, double precision, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_journey_location(uuid, double precision, double precision, double precision, timestamptz) TO authenticated;

-- Links a journey to the real emergency session the user opened from it.
CREATE OR REPLACE FUNCTION public.safe_journey_attach_emergency(_journey_id uuid, _emergency_id uuid)
RETURNS public.safe_journeys
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.safe_journeys;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.emergencies WHERE id = _emergency_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'Emergency not found';
  END IF;

  SELECT * INTO _row FROM public.safe_journeys WHERE id = _journey_id AND user_id = _uid FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Journey not found'; END IF;

  UPDATE public.safe_journeys
  SET emergency_id = _emergency_id,
      status = CASE WHEN public.safe_journey_can_transition(status,'emergency_escalated') THEN 'emergency_escalated' ELSE status END
  WHERE id = _row.id RETURNING * INTO _row;

  INSERT INTO public.safe_journey_events (journey_id, user_id, label, detail)
  VALUES (_row.id, _uid, 'Emergency session opened from journey', 'The emergency session is now the source of truth.');

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (_emergency_id, _uid, 'Safe Journey context attached',
    format('Journey "%s": %s → %s, expected by %s. Guardian: %s. Journey status: %s.',
      _row.name, COALESCE(_row.origin_address,'unknown start'), _row.destination_address,
      to_char(_row.expected_arrival_at,'DD Mon HH24:MI'), _row.guardian_name, _row.status));

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_journey_attach_emergency(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safe_journey_attach_emergency(uuid, uuid) TO authenticated;

-- Guardian view: only journeys explicitly shared with the signed-in account's
-- email, and only the minimum fields a guardian needs.
CREATE OR REPLACE FUNCTION public.guardian_safe_journeys()
RETURNS TABLE (
  journey_id uuid, traveller_name text, journey_name text, destination_address text,
  status text, expected_arrival_at timestamptz, last_latitude double precision,
  last_longitude double precision, last_location_at timestamptz,
  guardian_notified_at timestamptz, emergency_id uuid, traveller_phone text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT j.id, COALESCE(p.full_name, 'RESQORA user'), j.name, j.destination_address,
         j.status, j.expected_arrival_at,
         CASE WHEN j.sharing_enabled THEN j.last_latitude END,
         CASE WHEN j.sharing_enabled THEN j.last_longitude END,
         CASE WHEN j.sharing_enabled THEN j.last_location_at END,
         j.guardian_notified_at, j.emergency_id, p.phone
  FROM public.safe_journeys j
  LEFT JOIN public.profiles p ON p.id = j.user_id
  WHERE j.status = ANY (public.safe_journey_live_statuses())
    AND j.guardian_email IS NOT NULL
    AND j.guardian_email = lower(btrim(COALESCE((auth.jwt() ->> 'email'), '')))
  ORDER BY j.expected_arrival_at ASC
$$;

REVOKE ALL ON FUNCTION public.guardian_safe_journeys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_safe_journeys() TO authenticated;

-- Realtime for the journey tables so both the traveller and the guardian see
-- changes without polling.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.safe_journeys;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.safe_journey_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

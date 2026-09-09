-- ============================================================
-- 1. Emergency session provenance (reused session, not a new one)
-- ============================================================
ALTER TABLE public.emergencies
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS reporter_phone text;

-- ============================================================
-- 2. Volunteer network
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.volunteer_status AS ENUM ('pending','verified','suspended','expired','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.volunteer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  skills text[] NOT NULL DEFAULT '{}',
  experience text,
  radius_km double precision NOT NULL DEFAULT 5,
  availability text NOT NULL DEFAULT 'offline',
  verification_status public.volunteer_status NOT NULL DEFAULT 'pending',
  verification_note text,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  share_location boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.volunteer_profiles TO authenticated;
GRANT ALL ON public.volunteer_profiles TO service_role;
ALTER TABLE public.volunteer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Volunteers read own profile"
  ON public.volunteer_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Volunteers create own profile"
  ON public.volunteer_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Volunteers update own profile"
  ON public.volunteer_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS volunteer_profiles_matching_idx
  ON public.volunteer_profiles (verification_status, availability, active);
CREATE INDEX IF NOT EXISTS volunteer_profiles_position_idx
  ON public.volunteer_profiles (latitude, longitude);

CREATE TRIGGER volunteer_profiles_updated_at
  BEFORE UPDATE ON public.volunteer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Verification is never self-granted.
CREATE OR REPLACE FUNCTION public.guard_volunteer_verification()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change a verification status';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER volunteer_profiles_guard_verification
  BEFORE UPDATE ON public.volunteer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_volunteer_verification();

CREATE OR REPLACE FUNCTION public.block_verified_on_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.verification_status <> 'pending' AND NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.verification_status := 'pending';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER volunteer_profiles_pending_on_insert
  BEFORE INSERT ON public.volunteer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_verified_on_insert();

CREATE TABLE IF NOT EXISTS public.volunteer_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  volunteer_id uuid NOT NULL REFERENCES public.volunteer_profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status public.volunteer_status NOT NULL,
  note text,
  decided_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.volunteer_verifications TO authenticated;
GRANT ALL ON public.volunteer_verifications TO service_role;
ALTER TABLE public.volunteer_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Volunteers read own verification history"
  ON public.volunteer_verifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS volunteer_verifications_volunteer_idx
  ON public.volunteer_verifications (volunteer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.volunteer_incident_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
  volunteer_id uuid NOT NULL REFERENCES public.volunteer_profiles(id) ON DELETE CASCADE,
  volunteer_user_id uuid NOT NULL,
  victim_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offered',
  assistance_required text[] NOT NULL DEFAULT '{}',
  emergency_type text,
  distance_km double precision,
  exclusive boolean NOT NULL DEFAULT true,
  offered_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (emergency_id, volunteer_id)
);

GRANT SELECT ON public.volunteer_incident_matches TO authenticated;
GRANT ALL ON public.volunteer_incident_matches TO service_role;
ALTER TABLE public.volunteer_incident_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Volunteer and victim read their own matches"
  ON public.volunteer_incident_matches FOR SELECT TO authenticated
  USING (
    volunteer_user_id = auth.uid()
    OR victim_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX IF NOT EXISTS volunteer_matches_volunteer_idx
  ON public.volunteer_incident_matches (volunteer_user_id, status, offered_at DESC);
CREATE INDEX IF NOT EXISTS volunteer_matches_emergency_idx
  ON public.volunteer_incident_matches (emergency_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS volunteer_matches_one_exclusive_accept
  ON public.volunteer_incident_matches (emergency_id)
  WHERE status = 'accepted' AND exclusive;

CREATE TRIGGER volunteer_matches_updated_at
  BEFORE UPDATE ON public.volunteer_incident_matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- matching ----------
CREATE OR REPLACE FUNCTION public.request_volunteer_assistance(
  _emergency_id uuid,
  _assistance text[] DEFAULT '{}',
  _radius_km double precision DEFAULT NULL,
  _exclusive boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  offered int := 0;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id;
  IF em.id IS NULL THEN RAISE EXCEPTION 'Emergency not found'; END IF;
  IF NOT (em.user_id = caller OR public.has_role(caller, 'admin')) THEN
    RAISE EXCEPTION 'Not allowed to request assistance for this incident';
  END IF;
  IF em.status IN ('resolved','cancelled') THEN
    RAISE EXCEPTION 'This emergency is already closed';
  END IF;
  IF em.latitude IS NULL OR em.longitude IS NULL THEN
    RETURN jsonb_build_object('offered', 0, 'reason', 'no_location');
  END IF;

  WITH eligible AS (
    SELECT v.id, v.user_id,
           2 * 6371 * asin(least(1, sqrt(
             power(sin(radians(v.latitude - em.latitude) / 2), 2) +
             cos(radians(em.latitude)) * cos(radians(v.latitude)) *
             power(sin(radians(v.longitude - em.longitude) / 2), 2)
           ))) AS distance_km,
           v.radius_km
    FROM public.volunteer_profiles v
    WHERE v.active
      AND v.verification_status = 'verified'
      AND v.availability = 'available'
      AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
      AND v.location_updated_at > now() - interval '2 hours'
      AND v.user_id <> em.user_id
      AND (
        COALESCE(array_length(_assistance, 1), 0) = 0
        OR v.skills && _assistance
      )
  ), picked AS (
    SELECT * FROM eligible
    WHERE distance_km <= LEAST(COALESCE(_radius_km, radius_km), radius_km)
    ORDER BY distance_km ASC
    LIMIT 10
  )
  INSERT INTO public.volunteer_incident_matches (
    emergency_id, volunteer_id, volunteer_user_id, victim_user_id,
    assistance_required, emergency_type, distance_km, exclusive
  )
  SELECT _emergency_id, p.id, p.user_id, em.user_id,
         COALESCE(_assistance, '{}'), COALESCE(em.incident_type, em.type),
         round(p.distance_km::numeric, 2), COALESCE(_exclusive, true)
  FROM picked p
  ON CONFLICT (emergency_id, volunteer_id) DO NOTHING;

  SELECT count(*) INTO offered
  FROM public.volunteer_incident_matches
  WHERE emergency_id = _emergency_id AND status = 'offered';

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (_emergency_id, em.user_id, 'Community assistance requested',
          offered || ' verified volunteer(s) nearby were asked to help.');

  RETURN jsonb_build_object('offered', offered);
END; $$;

REVOKE EXECUTE ON FUNCTION public.request_volunteer_assistance(uuid, text[], double precision, boolean) FROM anon;

-- ---------- volunteer's own request list (pre-acceptance: limited fields only) ----------
CREATE OR REPLACE FUNCTION public.volunteer_requests()
RETURNS TABLE(
  match_id uuid, status text, emergency_type text, assistance_required text[],
  distance_km double precision, approx_area text, offered_at timestamptz, exclusive boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.status, m.emergency_type, m.assistance_required, m.distance_km,
         -- Approximate area only: never the exact address before acceptance.
         COALESCE(NULLIF(split_part(COALESCE(e.address, ''), ',', 2), ''),
                  NULLIF(split_part(COALESCE(e.address, ''), ',', 1), ''),
                  'Approximate area unavailable') AS approx_area,
         m.offered_at, m.exclusive
  FROM public.volunteer_incident_matches m
  JOIN public.emergencies e ON e.id = m.emergency_id
  WHERE m.volunteer_user_id = auth.uid()
    AND m.status = 'offered'
    AND e.status NOT IN ('resolved','cancelled')
  ORDER BY m.offered_at DESC
  LIMIT 20;
$$;

REVOKE EXECUTE ON FUNCTION public.volunteer_requests() FROM anon;

-- ---------- accepted incidents (authorised exact location, no medical data) ----------
CREATE OR REPLACE FUNCTION public.volunteer_accepted_incidents()
RETURNS TABLE(
  match_id uuid, emergency_id uuid, reference text, status text, phase text,
  emergency_type text, severity text, assistance_required text[],
  latitude double precision, longitude double precision, address text,
  location_source text, notes text, victim_name text,
  responded_at timestamptz, emergency_status text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, e.id, upper(substring(e.id::text, 1, 8)), m.status, e.phase,
         COALESCE(e.incident_type, e.type), e.severity, m.assistance_required,
         e.latitude, e.longitude, e.address, e.location_source,
         left(COALESCE(e.notes, ''), 300),
         COALESCE(p.full_name, 'RESQORA user'),
         m.responded_at, e.status
  FROM public.volunteer_incident_matches m
  JOIN public.emergencies e ON e.id = m.emergency_id
  LEFT JOIN public.profiles p ON p.id = m.victim_user_id
  WHERE m.volunteer_user_id = auth.uid()
    AND m.status IN ('accepted','completed')
  ORDER BY m.responded_at DESC NULLS LAST
  LIMIT 50;
$$;

REVOKE EXECUTE ON FUNCTION public.volunteer_accepted_incidents() FROM anon;

-- ---------- atomic accept / decline ----------
CREATE OR REPLACE FUNCTION public.volunteer_respond(_match_id uuid, _accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller uuid := auth.uid();
  m public.volunteer_incident_matches;
  vol public.volunteer_profiles;
  claimed public.volunteer_incident_matches;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO m FROM public.volunteer_incident_matches
    WHERE id = _match_id AND volunteer_user_id = caller FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF m.status <> 'offered' THEN
    RETURN jsonb_build_object('claimed', false, 'status', m.status, 'reason', 'already_answered');
  END IF;

  SELECT * INTO vol FROM public.volunteer_profiles WHERE id = m.volunteer_id;
  IF vol.verification_status <> 'verified' THEN
    RAISE EXCEPTION 'Your volunteer account is not verified';
  END IF;

  IF NOT COALESCE(_accept, false) THEN
    UPDATE public.volunteer_incident_matches
       SET status = 'declined', responded_at = now()
     WHERE id = m.id;
    RETURN jsonb_build_object('claimed', false, 'status', 'declined');
  END IF;

  -- Atomic claim: the partial unique index guarantees only one exclusive accept.
  BEGIN
    UPDATE public.volunteer_incident_matches
       SET status = 'accepted', responded_at = now()
     WHERE id = m.id AND status = 'offered'
    RETURNING * INTO claimed;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.volunteer_incident_matches
       SET status = 'expired', responded_at = now()
     WHERE id = m.id AND status = 'offered';
    RETURN jsonb_build_object('claimed', false, 'status', 'expired', 'reason', 'taken');
  END;

  IF claimed.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'status', m.status, 'reason', 'already_answered');
  END IF;

  -- Other outstanding offers on an exclusive request are closed out.
  IF m.exclusive THEN
    UPDATE public.volunteer_incident_matches
       SET status = 'expired', responded_at = now()
     WHERE emergency_id = m.emergency_id AND status = 'offered' AND id <> m.id;
  END IF;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (m.emergency_id, m.victim_user_id, 'Good Samaritan accepted',
          vol.full_name || ' is coming to help'
          || COALESCE(' (' || m.distance_km || ' km away)', '') || '.');

  INSERT INTO public.notifications (user_id, category, title, body)
  VALUES (m.victim_user_id, 'emergency', 'A verified volunteer is on the way',
          vol.full_name || ' accepted your request for community assistance.');

  RETURN jsonb_build_object('claimed', true, 'status', 'accepted');
END; $$;

REVOKE EXECUTE ON FUNCTION public.volunteer_respond(uuid, boolean) FROM anon;

CREATE OR REPLACE FUNCTION public.volunteer_complete(_match_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.volunteer_incident_matches;
  vol public.volunteer_profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO m FROM public.volunteer_incident_matches
    WHERE id = _match_id AND volunteer_user_id = auth.uid() AND status = 'accepted' FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Accepted request not found'; END IF;
  SELECT * INTO vol FROM public.volunteer_profiles WHERE id = m.volunteer_id;

  UPDATE public.volunteer_incident_matches
     SET status = 'completed', completed_at = now() WHERE id = m.id;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (m.emergency_id, m.victim_user_id, 'Good Samaritan assistance complete',
          vol.full_name || COALESCE(' — ' || left(_note, 200), ''));

  RETURN jsonb_build_object('status', 'completed');
END; $$;

REVOKE EXECUTE ON FUNCTION public.volunteer_complete(uuid, text) FROM anon;

-- ---------- volunteers attached to an emergency (owner / admin view) ----------
CREATE OR REPLACE FUNCTION public.emergency_volunteers(_emergency_id uuid)
RETURNS TABLE(
  match_id uuid, volunteer_name text, volunteer_phone text, skills text[],
  status text, distance_km double precision, responded_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, v.full_name,
         -- Contact details only once the volunteer has actually accepted.
         CASE WHEN m.status IN ('accepted','completed') THEN v.phone END,
         v.skills, m.status, m.distance_km, m.responded_at
  FROM public.volunteer_incident_matches m
  JOIN public.volunteer_profiles v ON v.id = m.volunteer_id
  JOIN public.emergencies e ON e.id = m.emergency_id
  WHERE m.emergency_id = _emergency_id
    AND (e.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ORDER BY m.status, m.distance_km NULLS LAST;
$$;

REVOKE EXECUTE ON FUNCTION public.emergency_volunteers(uuid) FROM anon;

ALTER PUBLICATION supabase_realtime ADD TABLE public.volunteer_incident_matches;

-- ============================================================
-- 3. Inbound SMS emergency entry point
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sms_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  sender_phone text NOT NULL,
  payload_hash text NOT NULL,
  command text,
  body text,
  status text NOT NULL DEFAULT 'received',
  emergency_id uuid REFERENCES public.emergencies(id) ON DELETE SET NULL,
  matched_user_id uuid,
  reply text,
  error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_message_id)
);

GRANT SELECT ON public.sms_webhook_events TO authenticated;
GRANT ALL ON public.sms_webhook_events TO service_role;
ALTER TABLE public.sms_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read inbound SMS log"
  ON public.sms_webhook_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS sms_webhook_events_sender_idx
  ON public.sms_webhook_events (sender_phone, received_at DESC);

CREATE OR REPLACE FUNCTION public.normalise_phone(_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT right(regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g'), 10);
$$;

/**
 * Processes one inbound SMS. Idempotent on (provider, provider_message_id):
 * a retried webhook returns the original reply and never opens a second
 * emergency. Runs as definer because the sender has no session.
 */
CREATE OR REPLACE FUNCTION public.sms_ingest(
  _provider text, _message_id text, _from text, _body text, _payload_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev public.sms_webhook_events;
  digits text := public.normalise_phone(_from);
  clean text := btrim(left(COALESCE(_body, ''), 300));
  upper_body text;
  cmd text;
  rest text;
  prof public.profiles;
  em public.emergencies;
  place text;
  loc_source text;
  reply text;
  kind text := 'sos';
  recent int;
BEGIN
  IF _provider IS NULL OR _message_id IS NULL OR digits = '' THEN
    RAISE EXCEPTION 'Invalid inbound message';
  END IF;

  -- Idempotency: claim this provider message id, or replay the stored reply.
  INSERT INTO public.sms_webhook_events (provider, provider_message_id, sender_phone, payload_hash, body)
  VALUES (_provider, _message_id, digits, COALESCE(_payload_hash, ''), clean)
  ON CONFLICT (provider, provider_message_id) DO NOTHING
  RETURNING * INTO ev;

  IF ev.id IS NULL THEN
    SELECT * INTO ev FROM public.sms_webhook_events
     WHERE provider = _provider AND provider_message_id = _message_id;
    RETURN jsonb_build_object('duplicate', true, 'reply', ev.reply,
                              'emergency_id', ev.emergency_id);
  END IF;

  -- Abuse guard per sender.
  SELECT count(*) INTO recent FROM public.sms_webhook_events
   WHERE sender_phone = digits AND received_at > now() - interval '10 minutes';
  IF recent > 12 THEN
    UPDATE public.sms_webhook_events SET status = 'rate_limited', processed_at = now(),
      reply = 'RESQORA: too many messages. Please call emergency services directly.'
     WHERE id = ev.id;
    RETURN jsonb_build_object('duplicate', false, 'reply',
      'RESQORA: too many messages. Please call emergency services directly.');
  END IF;

  upper_body := upper(clean);
  cmd := split_part(upper_body, ' ', 1);
  rest := btrim(substring(clean from length(cmd) + 1));

  -- The phone must belong to a RESQORA account, otherwise there is no
  -- verified person to open an emergency session for.
  SELECT * INTO prof FROM public.profiles
   WHERE public.normalise_phone(phone) = digits AND digits <> ''
   ORDER BY updated_at DESC LIMIT 1;

  IF prof.id IS NULL THEN
    reply := 'RESQORA: this number is not registered. Add your phone number in your RESQORA profile, or call emergency services directly.';
    UPDATE public.sms_webhook_events
       SET status = 'unknown_sender', command = cmd, reply = reply, processed_at = now()
     WHERE id = ev.id;
    RETURN jsonb_build_object('duplicate', false, 'reply', reply);
  END IF;

  SELECT * INTO em FROM public.emergencies
   WHERE user_id = prof.id AND status NOT IN ('resolved','cancelled')
   ORDER BY started_at DESC LIMIT 1;

  IF cmd = 'SAFE' THEN
    IF em.id IS NULL THEN
      reply := 'RESQORA: no active emergency found for this number.';
    ELSE
      PERFORM public.transition_emergency(em.id, 'resolved', 'Marked safe by SMS.');
      UPDATE public.emergencies SET resolved_at = COALESCE(resolved_at, now()) WHERE id = em.id;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, prof.id, 'Marked safe by SMS', 'Sender replied SAFE.');
      reply := 'RESQORA: marked safe. ID: RX-' || upper(substring(em.id::text, 1, 6)) || '.';
    END IF;

  ELSIF cmd = 'STATUS' THEN
    IF em.id IS NULL THEN
      reply := 'RESQORA: no active emergency for this number.';
    ELSE
      reply := 'RESQORA ID: RX-' || upper(substring(em.id::text, 1, 6))
        || '. Stage: ' || em.phase
        || '. Location: ' || COALESCE(NULLIF(em.address, ''), 'unknown')
        || ' (' || COALESCE(em.location_source, 'UNAVAILABLE') || ').';
    END IF;

  ELSIF cmd = 'LOCATION' THEN
    place := btrim(rest);
    IF em.id IS NULL THEN
      reply := 'RESQORA: no active emergency for this number. Send HELP to start one.';
    ELSIF place = '' THEN
      reply := 'RESQORA: reply LOCATION followed by your nearest landmark or area.';
    ELSE
      UPDATE public.emergencies
         SET address = left(place, 200), location_source = 'USER_PROVIDED',
             location_updated_at = now()
       WHERE id = em.id;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, prof.id, 'Location provided by SMS', left(place, 200));
      reply := 'RESQORA: location noted — ' || left(place, 120)
        || '. ID: RX-' || upper(substring(em.id::text, 1, 6)) || '.';
    END IF;

  ELSIF cmd IN ('HELP','SOS','AMBULANCE','POLICE','FIRE') THEN
    kind := CASE
      WHEN cmd = 'AMBULANCE' THEN 'medical'
      WHEN cmd = 'POLICE' THEN 'crime'
      WHEN cmd = 'FIRE' THEN 'fire'
      WHEN upper_body LIKE '%ACCIDENT%' THEN 'accident'
      WHEN upper_body LIKE '%FIRE%' THEN 'fire'
      WHEN upper_body LIKE '%MEDICAL%' THEN 'medical'
      ELSE 'sos' END;

    -- "near <place>" / "at <place>" in the message body.
    place := btrim(COALESCE(
      substring(clean from '(?i)\m(?:near|at|beside|opposite)\s+(.+)$'), ''));
    IF place <> '' THEN
      loc_source := 'USER_PROVIDED';
    END IF;

    IF em.id IS NULL THEN
      INSERT INTO public.emergencies (
        user_id, type, incident_type, severity, status, phase, live_status,
        relay_state, source, reporter_phone, address, location_source,
        incident_description, notes
      ) VALUES (
        prof.id, kind, kind, 'high', 'active', 'activated', 'help_requested',
        'created', 'sms', digits, NULLIF(left(place, 200), ''),
        COALESCE(loc_source, 'UNAVAILABLE'), left(clean, 300),
        'Reported by SMS from a feature phone.'
      ) RETURNING * INTO em;

      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, prof.id, 'Emergency opened by SMS',
              'Message: ' || left(clean, 200));

      -- Last known RESQORA location, only when the sender gave none.
      IF place = '' THEN
        SELECT p.latitude, p.longitude, p.created_at INTO em.latitude, em.longitude, em.location_updated_at
          FROM public.location_pings p WHERE p.user_id = prof.id
         ORDER BY p.created_at DESC LIMIT 1;
        IF em.latitude IS NOT NULL THEN
          UPDATE public.emergencies
             SET latitude = em.latitude, longitude = em.longitude,
                 location_source = 'LAST_KNOWN', location_updated_at = em.location_updated_at
           WHERE id = em.id;
          INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
          VALUES (em.id, prof.id, 'Last known location used',
                  'Recorded ' || to_char(em.location_updated_at, 'YYYY-MM-DD HH24:MI') || ' UTC. Not live GPS.');
        END IF;
      END IF;

      INSERT INTO public.notifications (user_id, category, title, body)
      VALUES (prof.id, 'emergency', 'Emergency opened by SMS',
              'An emergency was opened from your registered phone number by SMS.');

      SELECT * INTO em FROM public.emergencies WHERE id = em.id;

      IF em.address IS NULL AND em.latitude IS NULL THEN
        reply := 'RESQORA emergency received. ID: RX-' || upper(substring(em.id::text, 1, 6))
          || '. We could not determine your location. Reply with your nearest landmark or area.';
      ELSE
        reply := 'RESQORA emergency received. ID: RX-' || upper(substring(em.id::text, 1, 6))
          || '. Help is being coordinated. Reply SAFE when you are safe.';
      END IF;
    ELSE
      -- Same incident: update it, never open a second one.
      IF place <> '' THEN
        UPDATE public.emergencies
           SET address = left(place, 200), location_source = 'USER_PROVIDED',
               location_updated_at = now()
         WHERE id = em.id;
      END IF;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, prof.id, 'Further SMS received', left(clean, 200));
      reply := 'RESQORA: your emergency RX-' || upper(substring(em.id::text, 1, 6))
        || ' is already active. Reply SAFE when you are safe.';
    END IF;

  ELSE
    -- Free text while an emergency is open counts as a landmark reply.
    IF em.id IS NOT NULL AND clean <> '' THEN
      UPDATE public.emergencies
         SET address = left(clean, 200), location_source = 'USER_PROVIDED',
             location_updated_at = now()
       WHERE id = em.id;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, prof.id, 'Location provided by SMS', left(clean, 200));
      reply := 'RESQORA: location noted — ' || left(clean, 120)
        || '. ID: RX-' || upper(substring(em.id::text, 1, 6)) || '.';
    ELSE
      reply := 'RESQORA: send HELP to open an emergency. Other commands: SAFE, STATUS, LOCATION <landmark>.';
    END IF;
  END IF;

  UPDATE public.sms_webhook_events
     SET status = 'processed', command = cmd, reply = reply,
         emergency_id = em.id, matched_user_id = prof.id, processed_at = now()
   WHERE id = ev.id;

  RETURN jsonb_build_object('duplicate', false, 'reply', reply,
                            'emergency_id', em.id, 'event_id', ev.id);
END; $$;

REVOKE EXECUTE ON FUNCTION public.sms_ingest(text, text, text, text, text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.sms_record_delivery(_event_id uuid, _status text, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _status NOT IN ('pending','sent','delivered','failed') THEN
    RAISE EXCEPTION 'Unknown SMS delivery status';
  END IF;
  UPDATE public.sms_webhook_events
     SET status = 'reply_' || _status, error = left(_error, 300)
   WHERE id = _event_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.sms_record_delivery(uuid, text, text) FROM anon, authenticated;
-- 1. An emergency (and its timeline) may now belong to a verified phone number
-- with no RESQORA account, so a feature phone can raise a real emergency.
ALTER TABLE public.emergencies ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.emergency_events ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.volunteer_incident_matches ALTER COLUMN victim_user_id DROP NOT NULL;

-- Ownerless (SMS-only) incidents are operator-visible; existing owner policies
-- are untouched and never match a NULL user_id.
DROP POLICY IF EXISTS "Admins manage phone-only emergencies" ON public.emergencies;
CREATE POLICY "Admins manage phone-only emergencies" ON public.emergencies
  FOR UPDATE TO authenticated
  USING (user_id IS NULL AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id IS NULL AND public.has_role(auth.uid(), 'admin'));

-- 2. Automatic matching. Runs without a session (triggers, SMS webhook), so it
-- takes no caller input beyond the emergency and authorises nothing itself.
CREATE OR REPLACE FUNCTION public.match_volunteers_for(_emergency_id uuid, _assistance text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  em public.emergencies;
  need text[];
  offered int := 0;
  newly int := 0;
BEGIN
  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id;
  IF em.id IS NULL OR em.status IN ('resolved', 'cancelled') THEN RETURN 0; END IF;
  IF em.latitude IS NULL OR em.longitude IS NULL THEN RETURN 0; END IF;

  -- An unanswered offer expires after 3 minutes so the next volunteer is asked.
  UPDATE public.volunteer_incident_matches
     SET status = 'expired', responded_at = now()
   WHERE emergency_id = _emergency_id
     AND status = 'offered'
     AND offered_at < now() - interval '3 minutes';

  -- Someone already accepted: nothing more to ask.
  IF EXISTS (
    SELECT 1 FROM public.volunteer_incident_matches
     WHERE emergency_id = _emergency_id AND status IN ('accepted', 'completed')
  ) THEN
    RETURN 0;
  END IF;

  need := COALESCE(_assistance, CASE
    WHEN COALESCE(em.incident_type, em.type) IN ('medical', 'accident', 'sos')
      THEN ARRAY['first_aid', 'cpr', 'nurse', 'doctor', 'paramedic']
    WHEN COALESCE(em.incident_type, em.type) = 'fire'
      THEN ARRAY['fire_rescue', 'first_aid', 'disaster_volunteer']
    ELSE ARRAY[]::text[] END);

  WITH eligible AS (
    SELECT v.id, v.user_id, v.radius_km,
           2 * 6371 * asin(least(1, sqrt(
             power(sin(radians(v.latitude - em.latitude) / 2), 2) +
             cos(radians(em.latitude)) * cos(radians(v.latitude)) *
             power(sin(radians(v.longitude - em.longitude) / 2), 2)
           ))) AS distance_km
    FROM public.volunteer_profiles v
    WHERE v.active
      AND v.verification_status = 'verified'
      AND v.availability = 'available'
      AND v.share_location
      AND v.latitude IS NOT NULL AND v.longitude IS NOT NULL
      -- A stale position is not evidence of being nearby.
      AND v.location_updated_at > now() - interval '30 minutes'
      AND (em.user_id IS NULL OR v.user_id <> em.user_id)
      AND (COALESCE(array_length(need, 1), 0) = 0 OR v.skills && need)
      AND NOT EXISTS (
        SELECT 1 FROM public.volunteer_incident_matches m
         WHERE m.emergency_id = _emergency_id AND m.volunteer_id = v.id
      )
  ), picked AS (
    SELECT * FROM eligible WHERE distance_km <= radius_km
    ORDER BY distance_km ASC LIMIT 5
  ), inserted AS (
    INSERT INTO public.volunteer_incident_matches (
      emergency_id, volunteer_id, volunteer_user_id, victim_user_id,
      assistance_required, emergency_type, distance_km, exclusive
    )
    SELECT _emergency_id, p.id, p.user_id, em.user_id,
           COALESCE(need, '{}'), COALESCE(em.incident_type, em.type),
           round(p.distance_km::numeric, 2), true
    FROM picked p
    ON CONFLICT (emergency_id, volunteer_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO newly FROM inserted;

  SELECT count(*) INTO offered
  FROM public.volunteer_incident_matches
  WHERE emergency_id = _emergency_id AND status = 'offered';

  IF newly > 0 THEN
    INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
    VALUES (_emergency_id, em.user_id, 'Nearby volunteers matched',
            newly || ' verified volunteer(s) within range were asked to help.');
    IF em.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, category, title, body)
      VALUES (em.user_id, 'emergency', 'Nearby volunteers asked to help',
              newly || ' verified volunteer(s) nearby received your request.');
    END IF;
  END IF;

  RETURN offered;
END; $$;

REVOKE EXECUTE ON FUNCTION public.match_volunteers_for(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_volunteers_for(uuid, text[]) TO service_role;

-- 3. The manual button now delegates to exactly the same matching logic.
CREATE OR REPLACE FUNCTION public.request_volunteer_assistance(_emergency_id uuid, _assistance text[] DEFAULT NULL, _radius_km double precision DEFAULT NULL, _exclusive boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  offered int;
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

  offered := public.match_volunteers_for(
    _emergency_id,
    CASE WHEN COALESCE(array_length(_assistance, 1), 0) = 0 THEN NULL ELSE _assistance END);
  RETURN jsonb_build_object('offered', offered);
END; $$;

REVOKE EXECUTE ON FUNCTION public.request_volunteer_assistance(uuid, text[], double precision, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_volunteer_assistance(uuid, text[], double precision, boolean) TO authenticated;

-- 4. Matching fires by itself as soon as an emergency has coordinates.
CREATE OR REPLACE FUNCTION public.auto_match_on_emergency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
     AND NEW.status NOT IN ('resolved', 'cancelled')
     AND COALESCE(NEW.is_simulation, false) = false THEN
    PERFORM public.match_volunteers_for(NEW.id, NULL);
  END IF;
  RETURN NULL;
END; $$;

REVOKE EXECUTE ON FUNCTION public.auto_match_on_emergency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS emergencies_auto_match ON public.emergencies;
CREATE TRIGGER emergencies_auto_match
AFTER INSERT OR UPDATE OF latitude, longitude, status ON public.emergencies
FOR EACH ROW EXECUTE FUNCTION public.auto_match_on_emergency();

-- 5. Accept/decline now record the timeline and hand on to the next volunteer.
CREATE OR REPLACE FUNCTION public.volunteer_respond(_match_id uuid, _accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
    VALUES (m.emergency_id, m.victim_user_id, 'Volunteer declined',
            'A matched volunteer could not help. Searching for another.');
    -- Ask the next nearest eligible volunteer straight away.
    PERFORM public.match_volunteers_for(m.emergency_id, NULL);
    RETURN jsonb_build_object('claimed', false, 'status', 'declined');
  END IF;

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

  IF m.exclusive THEN
    UPDATE public.volunteer_incident_matches
       SET status = 'expired', responded_at = now()
     WHERE emergency_id = m.emergency_id AND status = 'offered' AND id <> m.id;
  END IF;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (m.emergency_id, m.victim_user_id, 'Verified community responder accepted',
          vol.full_name || ' is on the way'
          || COALESCE(' (' || m.distance_km || ' km away)', '') || '.');

  IF m.victim_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, category, title, body)
    VALUES (m.victim_user_id, 'emergency', 'A verified volunteer is on the way',
            vol.full_name || ' accepted your request for community assistance.');
  END IF;

  RETURN jsonb_build_object('claimed', true, 'status', 'accepted');
END; $$;

REVOKE EXECUTE ON FUNCTION public.volunteer_respond(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.volunteer_respond(uuid, boolean) TO authenticated;

-- 6. Only fresh, unanswered offers are shown to a volunteer.
CREATE OR REPLACE FUNCTION public.volunteer_requests()
RETURNS TABLE(match_id uuid, status text, emergency_type text, assistance_required text[], distance_km double precision, approx_area text, offered_at timestamptz, exclusive boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.status, m.emergency_type, m.assistance_required,
         m.distance_km::double precision,
         -- Approximate area only: no street address before accepting.
         COALESCE(NULLIF(split_part(COALESCE(e.address, ''), ',', 1), ''), 'Approximate area only'),
         m.offered_at, m.exclusive
  FROM public.volunteer_incident_matches m
  JOIN public.emergencies e ON e.id = m.emergency_id
  WHERE m.volunteer_user_id = auth.uid()
    AND m.status = 'offered'
    AND m.offered_at > now() - interval '3 minutes'
    AND e.status NOT IN ('resolved', 'cancelled')
  ORDER BY m.offered_at DESC
  LIMIT 20;
$$;

REVOKE EXECUTE ON FUNCTION public.volunteer_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.volunteer_requests() TO authenticated;

-- 7. SMS intake: unregistered senders get a real emergency session too.
CREATE OR REPLACE FUNCTION public.sms_ingest(_provider text, _message_id text, _from text, _body text, _payload_hash text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  owner uuid;
BEGIN
  IF _provider IS NULL OR _message_id IS NULL OR digits = '' THEN
    RAISE EXCEPTION 'Invalid inbound message';
  END IF;

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

  SELECT * INTO prof FROM public.profiles
   WHERE public.normalise_phone(phone) = digits AND digits <> ''
   ORDER BY updated_at DESC LIMIT 1;
  owner := prof.id;

  -- Registered or not, the sender's own live emergency is found by account
  -- when known, otherwise by the verified phone number that raised it.
  IF owner IS NOT NULL THEN
    SELECT * INTO em FROM public.emergencies
     WHERE user_id = owner AND status NOT IN ('resolved','cancelled')
     ORDER BY started_at DESC LIMIT 1;
  ELSE
    SELECT * INTO em FROM public.emergencies
     WHERE user_id IS NULL AND reporter_phone = digits
       AND status NOT IN ('resolved','cancelled')
     ORDER BY started_at DESC LIMIT 1;
  END IF;

  IF cmd = 'SAFE' THEN
    IF em.id IS NULL THEN
      reply := 'RESQORA: no active emergency found for this number.';
    ELSE
      UPDATE public.emergencies
         SET phase = 'resolved', phase_updated_at = now(), status = 'resolved',
             resolution_status = 'resolved', resolved_at = COALESCE(resolved_at, now())
       WHERE id = em.id;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, owner, 'Marked safe by SMS', 'Sender replied SAFE.');
      UPDATE public.volunteer_incident_matches
         SET status = 'expired', responded_at = now()
       WHERE emergency_id = em.id AND status = 'offered';
      reply := 'RESQORA: marked safe. ID: RX-' || upper(substring(em.id::text, 1, 6)) || '.';
    END IF;

  ELSIF cmd = 'STATUS' THEN
    IF em.id IS NULL THEN
      reply := 'RESQORA: no active emergency for this number.';
    ELSE
      reply := 'RESQORA ID: RX-' || upper(substring(em.id::text, 1, 6))
        || '. Stage: ' || em.phase
        || '. Location: ' || COALESCE(NULLIF(em.address, ''), 'unknown')
        || ' (' || COALESCE(em.location_source, 'UNAVAILABLE') || ').'
        || COALESCE((SELECT ' Volunteer ' || vp.full_name || ' accepted.'
                       FROM public.volunteer_incident_matches vm
                       JOIN public.volunteer_profiles vp ON vp.id = vm.volunteer_id
                      WHERE vm.emergency_id = em.id AND vm.status IN ('accepted','completed')
                      LIMIT 1), '');
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
      VALUES (em.id, owner, 'Location provided by SMS', left(place, 200));
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
        owner, kind, kind, 'high', 'active', 'activated', 'help_requested',
        'created', 'sms', digits, NULLIF(left(place, 200), ''),
        COALESCE(loc_source, 'UNAVAILABLE'), left(clean, 300),
        CASE WHEN owner IS NULL
          THEN 'Reported by SMS from an unregistered phone number.'
          ELSE 'Reported by SMS from a feature phone.' END
      ) RETURNING * INTO em;

      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, owner, 'Emergency created via SMS', 'Message: ' || left(clean, 200));

      -- Last known RESQORA location only for a known account, only when the
      -- sender gave no landmark, and always labelled as not-live.
      IF place = '' AND owner IS NOT NULL THEN
        SELECT p.latitude, p.longitude, p.created_at
          INTO em.latitude, em.longitude, em.location_updated_at
          FROM public.location_pings p WHERE p.user_id = owner
         ORDER BY p.created_at DESC LIMIT 1;
        IF em.latitude IS NOT NULL THEN
          UPDATE public.emergencies
             SET latitude = em.latitude, longitude = em.longitude,
                 location_source = 'LAST_KNOWN', location_updated_at = em.location_updated_at
           WHERE id = em.id;
          INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
          VALUES (em.id, owner, 'Last known location used',
                  'Recorded ' || to_char(em.location_updated_at, 'YYYY-MM-DD HH24:MI') || ' UTC. Not live GPS.');
        END IF;
      END IF;

      IF owner IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, category, title, body)
        VALUES (owner, 'emergency', 'Emergency created via SMS',
                'An emergency was opened from your registered phone number by SMS.');
      END IF;

      SELECT * INTO em FROM public.emergencies WHERE id = em.id;

      IF em.address IS NULL AND em.latitude IS NULL THEN
        reply := 'RESQORA emergency received. ID: RX-' || upper(substring(em.id::text, 1, 6))
          || '. We could not determine your location. Reply with your nearest landmark or area.';
      ELSE
        reply := 'RESQORA emergency received. ID: RX-' || upper(substring(em.id::text, 1, 6))
          || '. Help is being coordinated. Reply SAFE when you are safe.';
      END IF;
    ELSE
      IF place <> '' THEN
        UPDATE public.emergencies
           SET address = left(place, 200), location_source = 'USER_PROVIDED',
               location_updated_at = now()
         WHERE id = em.id;
      END IF;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, owner, 'Further SMS received', left(clean, 200));
      reply := 'RESQORA: your emergency RX-' || upper(substring(em.id::text, 1, 6))
        || ' is already active. Reply SAFE when you are safe.';
    END IF;

  ELSE
    IF em.id IS NOT NULL AND clean <> '' THEN
      UPDATE public.emergencies
         SET address = left(clean, 200), location_source = 'USER_PROVIDED',
             location_updated_at = now()
       WHERE id = em.id;
      INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
      VALUES (em.id, owner, 'Location provided by SMS', left(clean, 200));
      reply := 'RESQORA: location noted — ' || left(clean, 120)
        || '. ID: RX-' || upper(substring(em.id::text, 1, 6)) || '.';
    ELSE
      reply := 'RESQORA: send HELP to open an emergency. Other commands: SAFE, STATUS, LOCATION <landmark>.';
    END IF;
  END IF;

  UPDATE public.sms_webhook_events
     SET status = 'processed', command = cmd, reply = reply,
         emergency_id = em.id, matched_user_id = owner, processed_at = now()
   WHERE id = ev.id;

  RETURN jsonb_build_object('duplicate', false, 'reply', reply,
                            'emergency_id', em.id, 'event_id', ev.id,
                            'registered', owner IS NOT NULL,
                            'has_location', em.latitude IS NOT NULL OR em.address IS NOT NULL);
END; $$;

REVOKE EXECUTE ON FUNCTION public.sms_ingest(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_ingest(text, text, text, text, text) TO service_role;

-- 8. Live updates: the Command Centre, victim and volunteer all read changes as
-- they are written, with no polling.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND tablename = 'emergencies') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergencies;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND tablename = 'emergency_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_events;
  END IF;
END $$;

ALTER TABLE public.emergencies REPLICA IDENTITY FULL;
ALTER TABLE public.emergency_events REPLICA IDENTITY FULL;
ALTER TABLE public.volunteer_incident_matches REPLICA IDENTITY FULL;
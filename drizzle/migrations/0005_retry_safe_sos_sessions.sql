CREATE OR REPLACE FUNCTION public.start_emergency_session_v2(
  _type text,
  _severity text,
  _notes text,
  _idempotency_key text DEFAULT NULL,
  _latitude double precision DEFAULT NULL,
  _longitude double precision DEFAULT NULL,
  _accuracy double precision DEFAULT NULL,
  _address text DEFAULT NULL,
  _started_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  existing public.emergencies;
  created public.emergencies;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF COALESCE(NULLIF(_type, ''), 'sos') NOT IN ('medical','accident','fire','crime','natural','sos') THEN
    RAISE EXCEPTION 'Invalid emergency type';
  END IF;
  IF COALESCE(NULLIF(_severity, ''), 'high') NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'Invalid emergency severity';
  END IF;
  IF length(COALESCE(_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'Emergency notes are too long';
  END IF;
  IF _idempotency_key IS NOT NULL AND (length(_idempotency_key) < 8 OR length(_idempotency_key) > 100) THEN
    RAISE EXCEPTION 'Invalid emergency retry key';
  END IF;
  IF (_latitude IS NULL) <> (_longitude IS NULL) THEN
    RAISE EXCEPTION 'Both latitude and longitude are required';
  END IF;
  IF _latitude IS NOT NULL AND (
    _latitude NOT BETWEEN -90 AND 90 OR
    _longitude NOT BETWEEN -180 AND 180 OR
    _accuracy IS NOT NULL AND (_accuracy < 0 OR _accuracy > 100000)
  ) THEN
    RAISE EXCEPTION 'Invalid emergency coordinates';
  END IF;
  IF length(COALESCE(_address, '')) > 500 THEN
    RAISE EXCEPTION 'Emergency address is too long';
  END IF;
  IF _started_at IS NOT NULL AND _started_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Emergency activation time cannot be in the future';
  END IF;

  -- A retry first looks for the exact queued activation, even if it was closed
  -- after the original response was lost.
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO existing
      FROM public.emergencies
     WHERE user_id = caller AND idempotency_key = _idempotency_key
     LIMIT 1
     FOR UPDATE;
    IF existing.id IS NOT NULL THEN
      RETURN jsonb_build_object('emergency', to_jsonb(existing), 'reused', true);
    END IF;
  END IF;

  -- Only one live emergency may exist for this account.
  SELECT * INTO existing
    FROM public.emergencies
   WHERE user_id = caller AND status NOT IN ('resolved', 'cancelled')
   ORDER BY started_at DESC
   LIMIT 1
   FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('emergency', to_jsonb(existing), 'reused', true);
  END IF;

  BEGIN
    INSERT INTO public.emergencies (
      user_id, type, severity, status, notes, idempotency_key,
      latitude, longitude, location_accuracy, address,
      location_updated_at, started_at, source
    ) VALUES (
      caller,
      COALESCE(NULLIF(_type, ''), 'sos'),
      COALESCE(NULLIF(_severity, ''), 'high'),
      'created',
      NULLIF(_notes, ''),
      _idempotency_key,
      _latitude,
      _longitude,
      _accuracy,
      NULLIF(_address, ''),
      CASE WHEN _latitude IS NOT NULL THEN now() ELSE NULL END,
      COALESCE(_started_at, now()),
      CASE WHEN _idempotency_key LIKE 'local-%' THEN 'offline_queue' ELSE 'app' END
    ) RETURNING * INTO created;

    RETURN jsonb_build_object('emergency', to_jsonb(created), 'reused', false);
  EXCEPTION WHEN unique_violation THEN
    IF _idempotency_key IS NOT NULL THEN
      SELECT * INTO existing FROM public.emergencies
       WHERE user_id = caller AND idempotency_key = _idempotency_key LIMIT 1;
    END IF;
    IF existing.id IS NULL THEN
      SELECT * INTO existing FROM public.emergencies
       WHERE user_id = caller AND status NOT IN ('resolved', 'cancelled')
       ORDER BY started_at DESC LIMIT 1;
    END IF;
    IF existing.id IS NULL THEN
      RAISE EXCEPTION 'Could not start the emergency session';
    END IF;
    RETURN jsonb_build_object('emergency', to_jsonb(existing), 'reused', true);
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.start_emergency_session_v2(text,text,text,text,double precision,double precision,double precision,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_emergency_session_v2(text,text,text,text,double precision,double precision,double precision,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_emergency_session_v2(text,text,text,text,double precision,double precision,double precision,text,timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.replace_emergency_contacts(p_user_id uuid, p_contacts jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  item jsonb;
  idx int := 0;
  v_name text;
  v_rel text;
  v_phone text;
  v_email text;
  v_guardian boolean;
  seen_phones text[] := '{}';
BEGIN
  IF caller IS NULL OR p_user_id IS NULL OR caller <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_contacts IS NULL OR jsonb_typeof(p_contacts) <> 'array' THEN
    RAISE EXCEPTION 'Contacts must be a list';
  END IF;

  IF jsonb_array_length(p_contacts) > 10 THEN
    RAISE EXCEPTION 'At most 10 emergency contacts are allowed';
  END IF;

  -- Validate everything BEFORE touching existing rows so an invalid payload
  -- can never wipe the caller's contacts.
  FOR item IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    v_name := btrim(COALESCE(item->>'name', ''));
    v_rel := btrim(COALESCE(item->>'relationship', ''));
    v_phone := btrim(COALESCE(item->>'phone', ''));
    v_email := NULLIF(btrim(COALESCE(item->>'email', '')), '');

    IF length(v_name) < 2 OR length(v_name) > 80 THEN
      RAISE EXCEPTION 'Each contact needs a name (2-80 characters)';
    END IF;
    IF length(v_rel) = 0 OR length(v_rel) > 60 THEN
      RAISE EXCEPTION 'Each contact needs a relationship';
    END IF;
    IF length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 OR length(v_phone) > 30 THEN
      RAISE EXCEPTION 'Each contact needs a valid phone number';
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
      RAISE EXCEPTION 'Contact email address is not valid';
    END IF;
    IF regexp_replace(v_phone, '[^0-9]', '', 'g') = ANY (seen_phones) THEN
      RAISE EXCEPTION 'Duplicate contact phone number';
    END IF;
    seen_phones := seen_phones || regexp_replace(v_phone, '[^0-9]', '', 'g');
  END LOOP;

  DELETE FROM public.emergency_contacts WHERE user_id = caller;

  FOR item IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    v_name := btrim(item->>'name');
    v_rel := btrim(item->>'relationship');
    v_phone := btrim(item->>'phone');
    v_email := NULLIF(btrim(COALESCE(item->>'email', '')), '');
    v_guardian := COALESCE((item->>'is_guardian')::boolean, idx = 0);

    INSERT INTO public.emergency_contacts (user_id, name, relationship, phone, email, position, is_guardian)
    VALUES (caller, v_name, v_rel, v_phone, v_email, idx, v_guardian);
    idx := idx + 1;
  END LOOP;

  RETURN idx;
END;
$$;

COMMENT ON FUNCTION public.replace_emergency_contacts(uuid, jsonb) IS
  'Atomically replaces the authenticated user''s emergency contacts. Validates all input before deleting, so a failure rolls back and leaves existing contacts intact.';

REVOKE ALL ON FUNCTION public.replace_emergency_contacts(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_emergency_contacts(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_emergency_contacts(uuid, jsonb) TO authenticated;
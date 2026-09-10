-- Shared normalisers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalise_mobile(_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  digits text := regexp_replace(COALESCE(_phone, ''), '[^0-9]', '', 'g');
BEGIN
  -- Accept +91 / 0 prefixed input by keeping the last 10 digits only.
  IF length(digits) > 10 THEN
    digits := right(digits, 10);
  END IF;
  IF digits ~ '^[6-9][0-9]{9}$' THEN
    RETURN digits;
  END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.normalise_email(_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  e text := lower(btrim(COALESCE(_email, '')));
BEGIN
  IF e = '' THEN RETURN NULL; END IF;
  IF e ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$'
     AND e NOT LIKE '%..%' THEN
    RETURN e;
  END IF;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.is_person_name(_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(COALESCE(_name, '')) ~ '^[A-Za-z][A-Za-z''\.\- ]{1,79}$';
$$;

REVOKE ALL ON FUNCTION public.normalise_mobile(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalise_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_person_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalise_mobile(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalise_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_person_name(text) TO authenticated, service_role;

-- Profiles ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_profile_input()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  IF NULLIF(btrim(COALESCE(NEW.phone, '')), '') IS NOT NULL THEN
    cleaned := public.normalise_mobile(NEW.phone);
    IF cleaned IS NULL THEN
      RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
    END IF;
    NEW.phone := cleaned;
  ELSE
    NEW.phone := NULL;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.full_name, '')), '') IS NOT NULL THEN
    NEW.full_name := btrim(NEW.full_name);
    IF NOT public.is_person_name(NEW.full_name) THEN
      RAISE EXCEPTION 'Enter a valid name.';
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NOT NULL THEN
    cleaned := public.normalise_email(NEW.email);
    IF cleaned IS NULL THEN
      RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
    NEW.email := cleaned;
  END IF;

  IF NEW.date_of_birth IS NOT NULL THEN
    IF NEW.date_of_birth > CURRENT_DATE THEN
      RAISE EXCEPTION 'Date of birth cannot be in the future.';
    END IF;
    IF NEW.date_of_birth < CURRENT_DATE - INTERVAL '120 years' THEN
      RAISE EXCEPTION 'Enter a valid date of birth.';
    END IF;
  END IF;

  NEW.current_city := NULLIF(btrim(COALESCE(NEW.current_city, '')), '');
  NEW.home_address := NULLIF(btrim(COALESCE(NEW.home_address, '')), '');
  IF NEW.home_address IS NOT NULL AND length(NEW.home_address) < 5 THEN
    RAISE EXCEPTION 'Enter a fuller address (at least 5 characters).';
  END IF;
  IF NEW.current_city IS NOT NULL AND NOT (NEW.current_city ~ '[A-Za-z]{2}') THEN
    RAISE EXCEPTION 'Enter a valid city.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_profile_input ON public.profiles;
CREATE TRIGGER validate_profile_input
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_input();

-- Emergency contacts --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_emergency_contact()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned text;
  owner_phone text;
  dupes int;
BEGIN
  NEW.name := btrim(COALESCE(NEW.name, ''));
  IF NOT public.is_person_name(NEW.name) THEN
    RAISE EXCEPTION 'Enter a valid name.';
  END IF;

  NEW.relationship := btrim(COALESCE(NEW.relationship, ''));
  IF length(NEW.relationship) < 2 OR length(NEW.relationship) > 60 THEN
    RAISE EXCEPTION 'Enter a valid relationship.';
  END IF;

  cleaned := public.normalise_mobile(NEW.phone);
  IF cleaned IS NULL THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
  END IF;
  NEW.phone := cleaned;

  IF NULLIF(btrim(COALESCE(NEW.email, '')), '') IS NOT NULL THEN
    NEW.email := public.normalise_email(NEW.email);
    IF NEW.email IS NULL THEN
      RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
  ELSE
    NEW.email := NULL;
  END IF;

  SELECT p.phone INTO owner_phone FROM public.profiles p WHERE p.id = NEW.user_id;
  IF owner_phone IS NOT NULL AND public.normalise_mobile(owner_phone) = NEW.phone THEN
    RAISE EXCEPTION 'You cannot add your own number as an emergency contact.';
  END IF;

  SELECT count(*) INTO dupes
  FROM public.emergency_contacts c
  WHERE c.user_id = NEW.user_id
    AND c.id IS DISTINCT FROM NEW.id
    AND public.normalise_mobile(c.phone) = NEW.phone;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'This number is already saved as an emergency contact.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_emergency_contact ON public.emergency_contacts;
CREATE TRIGGER validate_emergency_contact
BEFORE INSERT OR UPDATE ON public.emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.validate_emergency_contact();

-- Volunteers ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_volunteer_input()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  NEW.full_name := btrim(COALESCE(NEW.full_name, ''));
  IF NOT public.is_person_name(NEW.full_name) THEN
    RAISE EXCEPTION 'Enter a valid name.';
  END IF;

  cleaned := public.normalise_mobile(NEW.phone);
  IF cleaned IS NULL THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
  END IF;
  NEW.phone := cleaned;

  IF NEW.skills IS NULL OR array_length(NEW.skills, 1) IS NULL THEN
    RAISE EXCEPTION 'Choose at least one skill you can offer.';
  END IF;

  NEW.experience := NULLIF(btrim(COALESCE(NEW.experience, '')), '');
  IF NEW.radius_km IS NULL OR NEW.radius_km < 1 OR NEW.radius_km > 50 THEN
    RAISE EXCEPTION 'Travel distance must be between 1 and 50 km.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_volunteer_input ON public.volunteer_profiles;
CREATE TRIGGER validate_volunteer_input
BEFORE INSERT OR UPDATE ON public.volunteer_profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_volunteer_input();

-- Blood donors --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_blood_donor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  NEW.full_name := btrim(COALESCE(NEW.full_name, ''));
  IF NOT public.is_person_name(NEW.full_name) THEN
    RAISE EXCEPTION 'Enter a valid name.';
  END IF;

  cleaned := public.normalise_mobile(NEW.phone);
  IF cleaned IS NULL THEN
    RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
  END IF;
  NEW.phone := cleaned;

  NEW.city := btrim(COALESCE(NEW.city, ''));
  IF length(NEW.city) < 2 OR NOT (NEW.city ~ '[A-Za-z]{2}') THEN
    RAISE EXCEPTION 'Enter a valid city.';
  END IF;

  IF NEW.blood_group IS NULL OR NEW.blood_group NOT IN ('A+','A-','B+','B-','AB+','AB-','O+','O-') THEN
    RAISE EXCEPTION 'Choose a valid blood group.';
  END IF;

  IF NEW.last_donation_date IS NOT NULL AND NEW.last_donation_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Last donation date cannot be in the future.';
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_blood_donor ON public.blood_donors;
CREATE TRIGGER validate_blood_donor
BEFORE INSERT OR UPDATE ON public.blood_donors
FOR EACH ROW EXECUTE FUNCTION public.validate_blood_donor();

-- Responder profiles --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_responder_input()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cleaned text;
BEGIN
  NEW.full_name := btrim(COALESCE(NEW.full_name, ''));
  IF NOT public.is_person_name(NEW.full_name) THEN
    RAISE EXCEPTION 'Enter a valid name.';
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.phone, '')), '') IS NOT NULL THEN
    cleaned := public.normalise_mobile(NEW.phone);
    IF cleaned IS NULL THEN
      RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
    END IF;
    NEW.phone := cleaned;
  ELSE
    NEW.phone := NULL;
  END IF;

  NEW.organisation := NULLIF(btrim(COALESCE(NEW.organisation, '')), '');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS validate_responder_input ON public.responder_profiles;
CREATE TRIGGER validate_responder_input
BEFORE INSERT OR UPDATE ON public.responder_profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_responder_input();

-- Atomic contact replacement now enforces the same 10-digit rule ------------
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
  owner_phone text;
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

  SELECT public.normalise_mobile(p.phone) INTO owner_phone
  FROM public.profiles p WHERE p.id = caller;

  -- Validate everything BEFORE touching existing rows so an invalid payload
  -- can never wipe the caller's contacts.
  FOR item IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    v_name := btrim(COALESCE(item->>'name', ''));
    v_rel := btrim(COALESCE(item->>'relationship', ''));
    v_phone := public.normalise_mobile(item->>'phone');
    v_email := NULLIF(btrim(COALESCE(item->>'email', '')), '');

    IF NOT public.is_person_name(v_name) THEN
      RAISE EXCEPTION 'Enter a valid name.';
    END IF;
    IF length(v_rel) < 2 OR length(v_rel) > 60 THEN
      RAISE EXCEPTION 'Enter a valid relationship.';
    END IF;
    IF v_phone IS NULL THEN
      RAISE EXCEPTION 'Enter a valid 10-digit Indian mobile number.';
    END IF;
    IF v_email IS NOT NULL AND public.normalise_email(v_email) IS NULL THEN
      RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
    IF owner_phone IS NOT NULL AND owner_phone = v_phone THEN
      RAISE EXCEPTION 'You cannot add your own number as an emergency contact.';
    END IF;
    IF v_phone = ANY (seen_phones) THEN
      RAISE EXCEPTION 'This number is already saved as an emergency contact.';
    END IF;
    seen_phones := seen_phones || v_phone;
  END LOOP;

  DELETE FROM public.emergency_contacts WHERE user_id = caller;

  FOR item IN SELECT * FROM jsonb_array_elements(p_contacts) LOOP
    v_name := btrim(item->>'name');
    v_rel := btrim(item->>'relationship');
    v_phone := public.normalise_mobile(item->>'phone');
    v_email := public.normalise_email(item->>'email');
    v_guardian := COALESCE((item->>'is_guardian')::boolean, idx = 0);

    INSERT INTO public.emergency_contacts (user_id, name, relationship, phone, email, position, is_guardian)
    VALUES (caller, v_name, v_rel, v_phone, v_email, idx, v_guardian);
    idx := idx + 1;
  END LOOP;

  RETURN idx;
END;
$$;
-- 1. responder role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'responder';

-- 2. responder profiles
CREATE TABLE public.responder_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  responder_type text NOT NULL DEFAULT 'medical',
  organisation text,
  phone text,
  availability text NOT NULL DEFAULT 'offline',
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.responder_profiles TO authenticated;
GRANT ALL ON public.responder_profiles TO service_role;
ALTER TABLE public.responder_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Responders manage their own profile" ON public.responder_profiles
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Signed-in users can see responders" ON public.responder_profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage responders" ON public.responder_profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER responder_profiles_updated_at BEFORE UPDATE ON public.responder_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. response resources
CREATE TABLE public.response_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  resource_type text NOT NULL DEFAULT 'ambulance',
  identifier text,
  organisation text,
  capacity integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'available',
  latitude double precision,
  longitude double precision,
  base_location text,
  assigned_emergency_id uuid REFERENCES public.emergencies(id) ON DELETE SET NULL,
  responder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_simulation boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.response_resources TO authenticated;
GRANT ALL ON public.response_resources TO service_role;
ALTER TABLE public.response_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can see resources" ON public.response_resources
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage resources" ON public.response_resources
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX response_resources_status_idx ON public.response_resources (status, resource_type);
CREATE TRIGGER response_resources_updated_at BEFORE UPDATE ON public.response_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. incident assignments
CREATE TABLE public.incident_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES public.response_resources(id) ON DELETE SET NULL,
  responder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_name text NOT NULL,
  resource_type text NOT NULL DEFAULT 'ambulance',
  status text NOT NULL DEFAULT 'assigned',
  eta_minutes integer,
  notes text,
  assigned_by uuid,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_assignments TO authenticated;
GRANT ALL ON public.incident_assignments TO service_role;
ALTER TABLE public.incident_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Incident owner can see assignments" ON public.incident_assignments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.emergencies e WHERE e.id = emergency_id AND e.user_id = auth.uid())
  );
CREATE POLICY "Assigned responder can see and update" ON public.incident_assignments
  FOR SELECT TO authenticated USING (responder_user_id = auth.uid());
CREATE POLICY "Admins manage assignments" ON public.incident_assignments
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX incident_assignments_emergency_idx ON public.incident_assignments (emergency_id, created_at DESC);
CREATE INDEX incident_assignments_responder_idx ON public.incident_assignments (responder_user_id, status);
CREATE TRIGGER incident_assignments_updated_at BEFORE UPDATE ON public.incident_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. hospital handoffs
CREATE TABLE public.hospital_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  hospital_name text NOT NULL,
  department text,
  bed_or_ward text,
  expected_arrival timestamptz,
  status text NOT NULL DEFAULT 'notified',
  handover_notes text,
  received_by text,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_handoffs TO authenticated;
GRANT ALL ON public.hospital_handoffs TO service_role;
ALTER TABLE public.hospital_handoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can see own handoffs" ON public.hospital_handoffs
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Assigned responder can see handoffs" ON public.hospital_handoffs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.incident_assignments a
      WHERE a.emergency_id = hospital_handoffs.emergency_id AND a.responder_user_id = auth.uid()
    )
  );
CREATE POLICY "Admins manage handoffs" ON public.hospital_handoffs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX hospital_handoffs_emergency_idx ON public.hospital_handoffs (emergency_id, created_at DESC);
CREATE TRIGGER hospital_handoffs_updated_at BEFORE UPDATE ON public.hospital_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. disaster zones
CREATE TABLE public.disaster_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  zone_type text NOT NULL DEFAULT 'flood',
  severity text NOT NULL DEFAULT 'moderate',
  advisory text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  radius_km double precision NOT NULL DEFAULT 2,
  active boolean NOT NULL DEFAULT true,
  is_simulation boolean NOT NULL DEFAULT false,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.disaster_zones TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disaster_zones TO authenticated;
GRANT ALL ON public.disaster_zones TO service_role;
ALTER TABLE public.disaster_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active zones are public advisories" ON public.disaster_zones
  FOR SELECT TO anon, authenticated USING (active = true);
CREATE POLICY "Admins manage zones" ON public.disaster_zones
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER disaster_zones_updated_at BEFORE UPDATE ON public.disaster_zones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. preparedness tasks
CREATE TABLE public.preparedness_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  done boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, task_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preparedness_tasks TO authenticated;
GRANT ALL ON public.preparedness_tasks TO service_role;
ALTER TABLE public.preparedness_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own preparedness tasks" ON public.preparedness_tasks
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER preparedness_tasks_updated_at BEFORE UPDATE ON public.preparedness_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. dispatch a resource (server-authorised, no double booking)
CREATE OR REPLACE FUNCTION public.dispatch_resource(_emergency_id uuid, _resource_id uuid, _eta_minutes integer DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  res public.response_resources;
  row public.incident_assignments;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id FOR UPDATE;
  IF em.id IS NULL THEN RAISE EXCEPTION 'Incident not found'; END IF;
  IF NOT (em.user_id = caller OR public.has_role(caller, 'admin')) THEN
    RAISE EXCEPTION 'Not allowed to dispatch for this incident';
  END IF;

  SELECT * INTO res FROM public.response_resources WHERE id = _resource_id AND active = true FOR UPDATE;
  IF res.id IS NULL THEN RAISE EXCEPTION 'Resource not found'; END IF;
  IF res.status <> 'available' OR (res.assigned_emergency_id IS NOT NULL AND res.assigned_emergency_id <> _emergency_id) THEN
    RAISE EXCEPTION '% is already committed to another incident', res.name;
  END IF;

  UPDATE public.response_resources
     SET status = 'dispatched', assigned_emergency_id = _emergency_id
   WHERE id = res.id;

  INSERT INTO public.incident_assignments (
    emergency_id, resource_id, responder_user_id, resource_name, resource_type,
    status, eta_minutes, notes, assigned_by
  ) VALUES (
    _emergency_id, res.id, res.responder_user_id, res.name, res.resource_type,
    'assigned', _eta_minutes, left(COALESCE(_notes, ''), 300), caller
  ) RETURNING * INTO row;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (_emergency_id, em.user_id, 'Resource dispatched',
          res.name || COALESCE(' — ETA ' || _eta_minutes || ' min', ''));

  UPDATE public.emergencies
     SET responder_status = 'dispatched'
   WHERE id = _emergency_id;

  PERFORM public.transition_emergency(_emergency_id, 'dispatched', res.name || ' assigned to this incident.');

  RETURN jsonb_build_object('assignment_id', row.id, 'resource', res.name, 'status', row.status);
END; $$;

-- 9. responder updates their assignment
CREATE OR REPLACE FUNCTION public.update_assignment_status(_assignment_id uuid, _status text, _eta_minutes integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  row public.incident_assignments;
  em public.emergencies;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _status NOT IN ('assigned','accepted','declined','en_route','on_scene','completed') THEN
    RAISE EXCEPTION 'Unknown assignment status';
  END IF;

  SELECT * INTO row FROM public.incident_assignments WHERE id = _assignment_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  SELECT * INTO em FROM public.emergencies WHERE id = row.emergency_id;

  IF NOT (row.responder_user_id = caller OR public.has_role(caller, 'admin') OR em.user_id = caller) THEN
    RAISE EXCEPTION 'Not allowed to update this assignment';
  END IF;

  UPDATE public.incident_assignments
     SET status = _status,
         eta_minutes = COALESCE(_eta_minutes, eta_minutes),
         accepted_at = CASE WHEN _status = 'accepted' AND accepted_at IS NULL THEN now() ELSE accepted_at END,
         completed_at = CASE WHEN _status IN ('completed','declined') THEN now() ELSE completed_at END
   WHERE id = row.id
  RETURNING * INTO row;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (row.emergency_id, em.user_id, 'Assignment ' || replace(_status, '_', ' '), row.resource_name);

  IF _status IN ('declined','completed') THEN
    UPDATE public.response_resources
       SET status = 'available', assigned_emergency_id = NULL
     WHERE id = row.resource_id;
  ELSIF _status = 'en_route' THEN
    UPDATE public.response_resources SET status = 'en_route' WHERE id = row.resource_id;
    PERFORM public.transition_emergency(row.emergency_id, 'en_route', row.resource_name || ' is on the way.');
  ELSIF _status = 'on_scene' THEN
    UPDATE public.response_resources SET status = 'on_scene' WHERE id = row.resource_id;
    PERFORM public.transition_emergency(row.emergency_id, 'arrived', row.resource_name || ' reached the scene.');
  ELSIF _status = 'accepted' THEN
    UPDATE public.emergencies SET responder_status = 'accepted' WHERE id = row.emergency_id;
  END IF;

  RETURN jsonb_build_object('id', row.id, 'status', row.status);
END; $$;

-- 10. hospital handoff
CREATE OR REPLACE FUNCTION public.record_hospital_handoff(_emergency_id uuid, _hospital text, _department text DEFAULT NULL, _bed text DEFAULT NULL, _eta timestamptz DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  em public.emergencies;
  row public.hospital_handoffs;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _hospital IS NULL OR length(btrim(_hospital)) = 0 THEN RAISE EXCEPTION 'Hospital name is required'; END IF;
  SELECT * INTO em FROM public.emergencies WHERE id = _emergency_id;
  IF em.id IS NULL THEN RAISE EXCEPTION 'Incident not found'; END IF;
  IF NOT (em.user_id = caller OR public.has_role(caller, 'admin')
          OR EXISTS (SELECT 1 FROM public.incident_assignments a
                     WHERE a.emergency_id = _emergency_id AND a.responder_user_id = caller)) THEN
    RAISE EXCEPTION 'Not allowed to record a handoff for this incident';
  END IF;

  INSERT INTO public.hospital_handoffs (
    emergency_id, user_id, hospital_name, department, bed_or_ward, expected_arrival, handover_notes, status
  ) VALUES (
    _emergency_id, em.user_id, left(btrim(_hospital), 160), _department, _bed, _eta,
    left(COALESCE(_notes, ''), 1000), 'notified'
  ) RETURNING * INTO row;

  UPDATE public.emergencies SET hospital_status = 'notified' WHERE id = _emergency_id;

  INSERT INTO public.emergency_events (emergency_id, user_id, label, detail)
  VALUES (_emergency_id, em.user_id, 'Hospital notified', row.hospital_name);

  PERFORM public.transition_emergency(_emergency_id, 'hospital_handoff', 'Handover to ' || row.hospital_name || '.');

  RETURN jsonb_build_object('id', row.id, 'hospital', row.hospital_name, 'status', row.status);
END; $$;

-- 11. lock down function execution to signed-in callers only
REVOKE ALL ON FUNCTION public.dispatch_resource(uuid, uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_assignment_status(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_hospital_handoff(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_resource(uuid, uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_assignment_status(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_hospital_handoff(uuid, text, text, text, timestamptz, text) TO authenticated;
REVOKE ALL ON FUNCTION public.transition_emergency(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_emergency(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.escalate_unacknowledged(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_unacknowledged(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_donor_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_donor_phone(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.search_blood_donors(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_blood_donors(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.my_guardian_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_guardian_links() TO authenticated;
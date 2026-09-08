DROP POLICY IF EXISTS "Signed-in users can see responders" ON public.responder_profiles;

CREATE POLICY "Responders see their own record"
ON public.responder_profiles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Assigned responders visible to the person they help"
ON public.responder_profiles FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.incident_assignments ia
    JOIN public.emergencies e ON e.id = ia.emergency_id
    WHERE ia.responder_user_id = responder_profiles.user_id
      AND e.user_id = auth.uid()
  )
);
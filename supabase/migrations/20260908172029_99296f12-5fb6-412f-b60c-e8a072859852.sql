DROP POLICY IF EXISTS "Signed-in users can see resources" ON public.response_resources;

CREATE POLICY "Coordinators see all resources"
ON public.response_resources FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'responder')
  OR responder_user_id = auth.uid()
);

CREATE POLICY "Users see free units and units attending their emergency"
ON public.response_resources FOR SELECT TO authenticated
USING (
  assigned_emergency_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.emergencies e
    WHERE e.id = response_resources.assigned_emergency_id
      AND e.user_id = auth.uid()
  )
);
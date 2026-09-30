ALTER TABLE public.emergency_alert_deliveries
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS emergency_alert_deliveries_dedupe_key_uidx
  ON public.emergency_alert_deliveries (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Only trusted server code (service role) may create or change email delivery rows.
CREATE OR REPLACE FUNCTION public.guard_email_delivery_writes()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.channel = 'email' THEN
    RAISE EXCEPTION 'Email notifications are created by the server only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.channel = 'email' OR NEW.channel = 'email') THEN
    RAISE EXCEPTION 'Email notifications are updated by the server only' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.channel = 'email' THEN
    RAISE EXCEPTION 'Email notifications cannot be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS guard_email_delivery_writes ON public.emergency_alert_deliveries;
CREATE TRIGGER guard_email_delivery_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.emergency_alert_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_email_delivery_writes();
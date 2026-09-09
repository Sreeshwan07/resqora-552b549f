-- Default PUBLIC EXECUTE has to be revoked explicitly; revoking from anon alone
-- leaves the PUBLIC grant in place.
REVOKE EXECUTE ON FUNCTION public.sms_ingest(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sms_record_delivery(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalise_phone(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.guard_volunteer_verification() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_verified_on_insert() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.request_volunteer_assistance(uuid, text[], double precision, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.volunteer_requests() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.volunteer_accepted_incidents() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.volunteer_respond(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.volunteer_complete(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.emergency_volunteers(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.request_volunteer_assistance(uuid, text[], double precision, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_accepted_incidents() TO authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_respond(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.volunteer_complete(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.emergency_volunteers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalise_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sms_ingest(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sms_record_delivery(uuid, text, text) TO service_role;
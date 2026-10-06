CREATE TABLE IF NOT EXISTS public.perf_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.perf_test_runs TO authenticated;
GRANT ALL ON public.perf_test_runs TO service_role;
ALTER TABLE public.perf_test_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own perf runs read" ON public.perf_test_runs;
CREATE POLICY "own perf runs read" ON public.perf_test_runs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "own perf runs insert" ON public.perf_test_runs;
CREATE POLICY "own perf runs insert" ON public.perf_test_runs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own perf runs delete" ON public.perf_test_runs;
CREATE POLICY "own perf runs delete" ON public.perf_test_runs FOR DELETE TO authenticated
  USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS perf_test_runs_user_idx ON public.perf_test_runs(user_id, created_at DESC);
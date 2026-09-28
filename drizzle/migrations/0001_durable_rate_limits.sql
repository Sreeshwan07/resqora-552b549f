CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_limit_buckets_unique UNIQUE (identifier, endpoint, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_window_idx ON public.rate_limit_buckets (window_start);

REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated, public;
GRANT ALL ON public.rate_limit_buckets TO service_role;
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- No policies: normal clients can never read or write buckets.

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _identifier text, _endpoint text, _window_seconds integer, _max integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _start timestamptz;
  _count integer;
BEGIN
  IF _identifier IS NULL OR length(_identifier) NOT BETWEEN 3 AND 200
     OR _endpoint IS NULL OR length(_endpoint) NOT BETWEEN 2 AND 80
     OR _window_seconds NOT BETWEEN 1 AND 86400 OR _max NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'invalid rate limit arguments';
  END IF;

  _start := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  -- Single atomic upsert: concurrent callers serialise on the unique row.
  INSERT INTO public.rate_limit_buckets AS b (identifier, endpoint, window_start, request_count)
  VALUES (_identifier, _endpoint, _start, 1)
  ON CONFLICT (identifier, endpoint, window_start)
  DO UPDATE SET request_count = b.request_count + 1, updated_at = now()
  RETURNING b.request_count INTO _count;

  -- Log only the first violation per bucket to avoid flooding.
  IF _count = _max + 1 THEN
    INSERT INTO public.security_events (user_id, event, detail, metadata)
    VALUES (
      CASE WHEN _identifier LIKE 'user:%' THEN nullif(substr(_identifier, 6), '')::uuid ELSE NULL END,
      'rate_limit_exceeded', _endpoint,
      jsonb_build_object('identifier', CASE WHEN _identifier LIKE 'anon:%' THEN _identifier ELSE NULL END,
                         'endpoint', _endpoint, 'limit', _max, 'window_seconds', _window_seconds)
    );
  END IF;

  -- Occasional cleanup of long-expired buckets only (never active ones).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN jsonb_build_object(
    'allowed', _count <= _max,
    'count', _count,
    'retry_after', greatest(1, ceil(extract(epoch FROM (_start + make_interval(secs => _window_seconds) - now())))::int)
  );
END $$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, integer, integer) TO service_role;
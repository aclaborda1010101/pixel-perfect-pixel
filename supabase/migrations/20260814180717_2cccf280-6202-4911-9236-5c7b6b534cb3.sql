CREATE TABLE IF NOT EXISTS public.job_locks (
  job_name text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  holder text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.job_locks TO service_role;

ALTER TABLE public.job_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_locks admin read" ON public.job_locks
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.try_acquire_job_lock(p_job_name text, p_ttl_seconds integer DEFAULT 240, p_holder text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ok boolean;
BEGIN
  DELETE FROM public.job_locks WHERE job_name = p_job_name AND expires_at < now();
  INSERT INTO public.job_locks (job_name, locked_at, expires_at, holder, updated_at)
  VALUES (p_job_name, now(), now() + make_interval(secs => greatest(10, p_ttl_seconds)), p_holder, now())
  ON CONFLICT (job_name) DO NOTHING;
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_job_lock(p_job_name text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.job_locks WHERE job_name = p_job_name;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_job_lock(text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_job_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_job_lock(text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_job_lock(text) TO service_role;

CREATE TRIGGER update_job_locks_updated_at
BEFORE UPDATE ON public.job_locks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE IF NOT EXISTS public.internal_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.internal_tokens TO service_role;
ALTER TABLE public.internal_tokens ENABLE ROW LEVEL SECURITY;
-- Sin políticas a propósito: ni anon ni usuarios firmados pueden leerla.

INSERT INTO public.internal_tokens (name, token)
VALUES ('cotejo_run', encode(gen_random_bytes(24), 'hex'))
ON CONFLICT (name) DO NOTHING;

SELECT cron.unschedule('cotejo_hubspot_masivo_3m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cotejo_hubspot_masivo_3m');

SELECT cron.schedule(
  'cotejo_hubspot_masivo_3m',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/cotejo_hubspot_masivo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('lote', 8),
    timeout_milliseconds := 120000
  )
  WHERE EXISTS (SELECT 1 FROM public.buildings WHERE hs_props_synced_at IS NULL);
  $$
);
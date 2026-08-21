CREATE TABLE IF NOT EXISTS public.backup_20260821_terciario_escala AS
SELECT id, direccion, pct_terciario AS antes, now() AS copiado_at
FROM public.buildings
WHERE pct_terciario > 0 AND pct_terciario <= 1;

ALTER TABLE public.backup_20260821_terciario_escala ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup_terciario_admin" ON public.backup_20260821_terciario_escala
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.backup_20260821_terciario_escala TO authenticated;
GRANT ALL ON public.backup_20260821_terciario_escala TO service_role;

UPDATE public.buildings
SET pct_terciario = round(pct_terciario * 100, 2)
WHERE pct_terciario > 0 AND pct_terciario <= 1;

UPDATE public.buildings
SET pct_residencial = round(pct_residencial * 100, 2)
WHERE pct_residencial > 0 AND pct_residencial <= 1;

SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('datos_inmueble_2m', 'datos_inmueble_noche_1', 'datos_inmueble_noche_2');

SELECT cron.schedule('datos_inmueble_2m', '*/2 * * * *', $c$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/backfill_datos_inmueble',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('tope', 300),
    timeout_milliseconds := 110000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.buildings b
    WHERE b.hs_deal_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.hs_inmueble_snapshot s WHERE s.building_id = b.id)
  );
$c$);

SELECT cron.schedule('datos_inmueble_noche_1', '10 2 * * *', $c$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/backfill_datos_inmueble',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('rehacer', true, 'tope', 700),
    timeout_milliseconds := 110000
  );
$c$);

SELECT cron.schedule('datos_inmueble_noche_2', '25 2 * * *', $c$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/backfill_datos_inmueble',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('rehacer', true, 'tope', 1500),
    timeout_milliseconds := 110000
  );
$c$);

SELECT net.http_post(
  url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/backfill_datos_inmueble',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
  ),
  body := jsonb_build_object('tope', 300),
  timeout_milliseconds := 110000
);

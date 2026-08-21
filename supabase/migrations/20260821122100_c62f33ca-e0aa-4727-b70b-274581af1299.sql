UPDATE public.buildings
SET distrito = NULLIF(regexp_replace(distrito, '\s*\(\d+\)\s*$', ''), ''),
    barrio   = NULLIF(regexp_replace(barrio,   '\s*\(\d+\)\s*$', ''), '')
WHERE distrito ~ '\(\d+\)\s*$' OR barrio ~ '\(\d+\)\s*$';

SELECT cron.unschedule('geocodificar_distritos_2m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'geocodificar_distritos_2m');

SELECT cron.schedule(
  'geocodificar_distritos_2m',
  '1-59/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/geocodificar_distritos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('lote', 50),
    timeout_milliseconds := 110000
  )
  WHERE EXISTS (
    SELECT 1 FROM public.buildings b
    JOIN public.catastro_data c ON c.building_id = b.id
    WHERE b.distrito IS NULL AND c.lat IS NOT NULL
  );
  $$
);
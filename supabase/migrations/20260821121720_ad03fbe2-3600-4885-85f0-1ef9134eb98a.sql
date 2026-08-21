SELECT cron.unschedule('cotejo_hubspot_masivo_3m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cotejo_hubspot_masivo_3m');

SELECT cron.schedule(
  'cotejo_hubspot_masivo_2m',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/cotejo_hubspot_masivo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cotejo-key', (SELECT token FROM public.internal_tokens WHERE name = 'cotejo_run')
    ),
    body := jsonb_build_object('lote', 12),
    timeout_milliseconds := 110000
  )
  WHERE EXISTS (SELECT 1 FROM public.buildings WHERE hs_props_synced_at IS NULL);
  $$
);
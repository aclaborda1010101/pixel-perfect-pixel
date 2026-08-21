DO $$
DECLARE
  v_cmd text;
  v_key text;
BEGIN
  SELECT command
    INTO v_cmd
  FROM cron.job
  WHERE command ~ 'Authorization'
    AND command ~ 'Bearer '
  ORDER BY jobid
  LIMIT 1;

  v_key := (regexp_match(v_cmd, '"(?:Authorization|apikey)"\s*:\s*"(?:Bearer )?([A-Za-z0-9._-]{40,})"'))[1];
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'No se encontró una credencial interna reutilizable para programar la sincronización';
  END IF;

  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'hubspot_contact_diagnostics_15m';

  PERFORM cron.schedule(
    'hubspot_contact_diagnostics_15m',
    '7,22,37,52 * * * *',
    format($job$
      SELECT net.http_post(
        url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/hubspot_sync_contact_diagnostics',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{"pages":20,"fallback_days":7}'::jsonb
      );
    $job$, v_key)
  );
END $$;
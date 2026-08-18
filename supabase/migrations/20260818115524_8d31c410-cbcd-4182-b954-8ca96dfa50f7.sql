DO $$
DECLARE
  v_cmd text;
  v_key text;
BEGIN
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'finalize_pending_retries_1m' LIMIT 1;
  v_key := (regexp_match(v_cmd, '"(?:Authorization|apikey)"\s*:\s*"(?:Bearer )?([A-Za-z0-9._-]{40,})"'))[1];
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'no se pudo reutilizar la credencial de los procesos programados';
  END IF;

  PERFORM cron.unschedule(jobname)
  FROM cron.job WHERE jobname IN ('hubspot_write_drain_1m', 'hubspot_write_pull_5m');

  PERFORM cron.schedule(
    'hubspot_write_drain_1m', '* * * * *',
    format($f$
      SELECT net.http_post(
        url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/hubspot_write_worker',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"accion":"drain","limite":25}'::jsonb
      );
    $f$, v_key)
  );

  PERFORM cron.schedule(
    'hubspot_write_pull_5m', '*/5 * * * *',
    format($f$
      SELECT net.http_post(
        url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/hubspot_write_worker',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
        body := '{"accion":"pull","limite":50}'::jsonb
      );
    $f$, v_key)
  );
END $$;
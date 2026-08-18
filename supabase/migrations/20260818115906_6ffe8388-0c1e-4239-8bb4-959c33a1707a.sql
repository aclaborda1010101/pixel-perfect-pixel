DO $$
DECLARE
  v_cmd text;
  v_key text;
  v_tok text := encode(gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO public.app_settings(key, value)
  VALUES ('hubspot_worker_token', to_jsonb(v_tok))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'finalize_pending_retries_1m' LIMIT 1;
  v_key := (regexp_match(v_cmd, '"(?:Authorization|apikey)"\s*:\s*"(?:Bearer )?([A-Za-z0-9._-]{40,})"'))[1];

  PERFORM cron.unschedule(jobname)
  FROM cron.job WHERE jobname IN ('hubspot_write_drain_1m', 'hubspot_write_pull_5m');

  PERFORM cron.schedule('hubspot_write_drain_1m', '* * * * *', format($f$
    SELECT net.http_post(
      url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/hubspot_write_worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s','x-worker-token','%s'),
      body := '{"accion":"drain","limite":25}'::jsonb);
  $f$, v_key, v_tok));

  PERFORM cron.schedule('hubspot_write_pull_5m', '*/5 * * * *', format($f$
    SELECT net.http_post(
      url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/hubspot_write_worker',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s','x-worker-token','%s'),
      body := '{"accion":"pull","limite":50}'::jsonb);
  $f$, v_key, v_tok));
END $$;

-- El secreto sólo lo lee el trabajador (rol de servicio).
REVOKE ALL ON public.app_settings FROM anon;
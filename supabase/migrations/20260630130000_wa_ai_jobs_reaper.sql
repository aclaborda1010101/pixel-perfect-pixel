-- R2 · Reaper de wa_ai_jobs cada minuto.
-- Reanima los jobs 'pending' estancados (cuyo fetch fire-and-forget del webhook nunca
-- completó) re-disparando la edge function wa_ai_jobs_reaper, que a su vez re-llama a
-- wa_ai_reply. El mutex atómico de wa_ai_reply (status pending->running) hace que el
-- re-disparo sea seguro: nunca produce doble respuesta.
-- Extensiones pg_cron + pg_net ya creadas en 20260510091023.

-- Idempotente: si ya existía una versión del cron, la desprogramamos antes de recrearla.
DO $$
BEGIN
  PERFORM cron.unschedule('wa-ai-jobs-reaper-1min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'wa-ai-jobs-reaper-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/wa_ai_jobs_reaper',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('source', 'pg_cron')
  );
  $$
);

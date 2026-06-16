-- Eliminar crons que consumen IA o disparan procesos costosos
SELECT cron.unschedule('coach-weekly');
SELECT cron.unschedule('analyze-daily');
SELECT cron.unschedule('transcribe-daily');
SELECT cron.unschedule('generate-embeddings-hourly');
SELECT cron.unschedule('learn_from_calls_daily');
SELECT cron.unschedule('sync_hubspot_calls_to_sessions_10min');
SELECT cron.unschedule('reprocess-cohort-77-watchdog');
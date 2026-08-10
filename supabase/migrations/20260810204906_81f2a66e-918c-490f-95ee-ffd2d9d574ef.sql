DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'finalize_pending_retries_1m',
      'audit_calls_retro_every_5m',
      'transcribe_calls_drain',
      'auto_analyze_hubspot_calls_5m',
      'notas_simples_reparse_5m',
      'integrity_watchdog_30m',
      'wa-match-backfill-every-10min',
      'auto_link_owner_building_10m',
      'link_orphan_contacts_10m',
      'notas_simples_attach_hourly',
      'notas_simples_ingest_hourly'
    )
    AND active
  LOOP
    PERFORM cron.alter_job(job_id => j.jobid, active => false);
    RAISE NOTICE 'paused %', j.jobname;
  END LOOP;

  FOR j IN
    SELECT jobid, jobname FROM cron.job WHERE jobname = 'hubspot_sync_incremental_5m'
  LOOP
    PERFORM cron.alter_job(job_id => j.jobid, schedule => '3,18,33,48 * * * *');
    RAISE NOTICE 'rescheduled %', j.jobname;
  END LOOP;
END $$;
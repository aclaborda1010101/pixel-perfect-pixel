SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN (
  'vacuum_buildings_esta_noche',
  'analyze_buildings_esta_noche',
  'analyze_building_owners_esta_noche',
  'analyze_calls_esta_noche'
);
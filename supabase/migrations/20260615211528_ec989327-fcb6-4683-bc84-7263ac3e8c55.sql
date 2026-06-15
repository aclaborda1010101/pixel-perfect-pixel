WITH lib AS (
  SELECT value FROM public.app_settings WHERE key = 'escaleras_fewshot_library'
),
ctrl AS (
  SELECT building_id::text AS bid FROM public.escaleras_control_set WHERE set_name='ctrl_10x10_v1'
),
filtered AS (
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) AS entries
  FROM lib, jsonb_array_elements(lib.value->'entries') AS e
  WHERE (e->>'building_id') NOT IN (SELECT bid FROM ctrl)
)
UPDATE public.app_settings s
SET value = jsonb_build_object(
  'entries', f.entries,
  'built_at', now()::text,
  'in_progress', false,
  'pruned_ctrl_leaks_at', now()::text
), updated_at = now()
FROM filtered f
WHERE s.key='escaleras_fewshot_library';

DELETE FROM public.escaleras_eval_results
WHERE set_name='ctrl_10x10_v1' AND version='v7.11-fewshot';
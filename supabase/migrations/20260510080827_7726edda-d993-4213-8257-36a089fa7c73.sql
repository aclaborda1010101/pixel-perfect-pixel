-- Backfill duracion_seg = 0 from HubSpot calls where source records 0ms duration.
-- Idempotent: only updates rows where duracion_seg IS NULL.
UPDATE public.calls c
SET duracion_seg = 0
FROM public.hubspot_calls hc
WHERE c.duracion_seg IS NULL
  AND c.resumen LIKE '[hs:' || hc.hs_id || '%'
  AND COALESCE(hc.hs_call_duration, 0) = 0;
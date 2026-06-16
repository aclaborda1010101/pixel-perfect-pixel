-- Borrar filas streetview antiguas (pre-fix geometría) de la cohorte 77
WITH c AS (SELECT DISTINCT building_id FROM building_processing_status)
DELETE FROM building_imagery bi
USING c
WHERE bi.building_id = c.building_id
  AND bi.source = 'streetview'
  AND bi.fetched_at < '2026-06-08'::timestamptz;
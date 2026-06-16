-- 1) Limpieza del caso reportado (Calle Alonso Heredia 25): la foto SV 157° es del edificio de enfrente.
DELETE FROM public.building_imagery
WHERE building_id = '3402ffbd-8dbe-4257-8132-8730f3c2ba2a'
  AND source = 'streetview'
  AND heading = 157;

-- 2) Limpieza general del cohorte 77: borrar la 4ª toma SV (heading "acera de enfrente",
--    rumbo opuesto al portal, ±15°) generada antes del fix de fetch-google-imagery.
--    Identificamos esa toma como la que dista 165–195° del heading dominante (el portal)
--    para cada building. Se borra solo la fila; el bucket se regenerará al refetch.
WITH cohort AS (
  SELECT building_id
  FROM public.building_analysis
  WHERE (metricas_extra ? 'reprocess_frozen_v1')
     OR building_id IN (SELECT building_id FROM public.qa_ground_truth)
),
dominant AS (
  -- El "portal" suele ser la mediana de los 3 headings cercanos; aproximamos con el
  -- heading que tiene al menos otro a <=30° de distancia (cluster del portal).
  SELECT bi.building_id, bi.heading
  FROM public.building_imagery bi
  WHERE bi.source = 'streetview'
    AND bi.building_id IN (SELECT building_id FROM cohort)
    AND EXISTS (
      SELECT 1 FROM public.building_imagery bj
      WHERE bj.building_id = bi.building_id
        AND bj.source = 'streetview'
        AND bj.id <> bi.id
        AND LEAST(
              ((bj.heading - bi.heading) % 360 + 360) % 360,
              ((bi.heading - bj.heading) % 360 + 360) % 360
            ) <= 30
    )
),
opposite AS (
  SELECT bi.id
  FROM public.building_imagery bi
  JOIN dominant d ON d.building_id = bi.building_id
  WHERE bi.source = 'streetview'
    AND bi.building_id IN (SELECT building_id FROM cohort)
    AND LEAST(
          ((bi.heading - d.heading) % 360 + 360) % 360,
          ((d.heading - bi.heading) % 360 + 360) % 360
        ) BETWEEN 150 AND 210
  GROUP BY bi.id
)
DELETE FROM public.building_imagery
WHERE id IN (SELECT id FROM opposite);
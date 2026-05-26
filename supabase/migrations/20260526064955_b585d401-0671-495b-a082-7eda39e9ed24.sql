-- Dedupe catastro_data: keep the row with the richest data (most plantas pages, then fxcc pages, most recent)
WITH ranked AS (
  SELECT ctid, building_id,
    ROW_NUMBER() OVER (
      PARTITION BY building_id
      ORDER BY
        (CASE WHEN plantas_pdf_disponible THEN 1 ELSE 0 END) DESC,
        COALESCE(jsonb_array_length(plantas_pages_urls), 0) DESC,
        (CASE WHEN fxcc_disponible THEN 1 ELSE 0 END) DESC,
        COALESCE(jsonb_array_length(fxcc_pages_urls), 0) DESC,
        fetched_at DESC NULLS LAST,
        updated_at DESC
    ) AS rn
  FROM public.catastro_data
  WHERE building_id IS NOT NULL
)
DELETE FROM public.catastro_data c
USING ranked r
WHERE c.ctid = r.ctid AND r.rn > 1;

-- Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS catastro_data_building_id_unique
  ON public.catastro_data(building_id)
  WHERE building_id IS NOT NULL;
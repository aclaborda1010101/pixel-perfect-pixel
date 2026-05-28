-- Deduplicate building_imagery rows keeping the latest fetched_at per (building_id, file_path)
DELETE FROM public.building_imagery a
USING public.building_imagery b
WHERE a.building_id = b.building_id
  AND a.file_path = b.file_path
  AND a.fetched_at < b.fetched_at;

-- Add unique constraint so future upserts work
CREATE UNIQUE INDEX IF NOT EXISTS building_imagery_building_file_unique
  ON public.building_imagery (building_id, file_path);
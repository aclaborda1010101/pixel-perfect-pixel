ALTER TABLE public.parcel_geometry_cache
  ADD COLUMN IF NOT EXISTS corner_type text,
  ADD COLUMN IF NOT EXISTS street_names_distinct text[];
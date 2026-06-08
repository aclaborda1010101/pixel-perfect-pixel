CREATE TABLE public.parcel_geometry_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refcatastral_14 text UNIQUE NOT NULL,
  exterior_ring jsonb NOT NULL,
  interior_rings jsonb NOT NULL DEFAULT '[]'::jsonb,
  bbox jsonb NOT NULL,
  centroid jsonb NOT NULL,
  area_m2 numeric,
  perimeter_m numeric,
  source text NOT NULL,
  confidence text NOT NULL,
  osm_id bigint,
  osm_type text,
  flags text[] NOT NULL DEFAULT '{}',
  raw_response jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

GRANT SELECT ON public.parcel_geometry_cache TO authenticated;
GRANT ALL ON public.parcel_geometry_cache TO service_role;

ALTER TABLE public.parcel_geometry_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read parcel geometry"
  ON public.parcel_geometry_cache FOR SELECT
  TO authenticated USING (true);

CREATE INDEX parcel_geometry_cache_refcat_idx ON public.parcel_geometry_cache(refcatastral_14);
CREATE INDEX parcel_geometry_cache_expires_idx ON public.parcel_geometry_cache(expires_at);
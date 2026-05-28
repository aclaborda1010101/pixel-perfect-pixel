
CREATE TABLE public.facade_window_counts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  refcatastral_14 TEXT NOT NULL,
  vlm_raw_response TEXT NOT NULL,
  vlm_parsed JSONB,
  street_view_panoramas JSONB NOT NULL DEFAULT '[]'::jsonb,
  fachada_principal JSONB NOT NULL,
  fachada_secundaria JSONB,
  longitud_fachada_m NUMERIC,
  longitud_fachada_source TEXT,
  final_count INTEGER NOT NULL,
  ejes_verticales INTEGER NOT NULL,
  confidence TEXT NOT NULL,
  flags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.facade_window_counts TO authenticated;
GRANT ALL ON public.facade_window_counts TO service_role;

ALTER TABLE public.facade_window_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view facade window counts"
  ON public.facade_window_counts FOR SELECT
  TO authenticated USING (true);

CREATE INDEX facade_window_counts_building_idx
  ON public.facade_window_counts(building_id, created_at DESC);
CREATE INDEX facade_window_counts_rc_idx
  ON public.facade_window_counts(refcatastral_14);

INSERT INTO storage.buckets (id, name, public)
VALUES ('street-view-captures', 'street-view-captures', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated can read street view captures"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'street-view-captures');

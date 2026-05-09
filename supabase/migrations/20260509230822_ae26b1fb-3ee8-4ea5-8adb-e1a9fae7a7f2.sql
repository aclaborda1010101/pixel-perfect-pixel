ALTER TABLE public.building_owners
  ADD COLUMN IF NOT EXISTS es_influencer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS influencer_score numeric,
  ADD COLUMN IF NOT EXISTS influencer_reason text;

CREATE INDEX IF NOT EXISTS idx_building_owners_influencer
  ON public.building_owners(building_id, es_influencer);
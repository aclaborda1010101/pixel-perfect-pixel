ALTER TABLE public.building_processing_status
  ADD COLUMN IF NOT EXISTS pipeline_stage text,
  ADD COLUMN IF NOT EXISTS phases jsonb NOT NULL DEFAULT '{}'::jsonb;
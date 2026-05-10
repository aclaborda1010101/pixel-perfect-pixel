ALTER TABLE public.calls 
  ADD COLUMN IF NOT EXISTS pivot_moments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tacticas_usadas text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_calls_tacticas_usadas ON public.calls USING GIN (tacticas_usadas);
CREATE INDEX IF NOT EXISTS idx_calls_pivot_moments ON public.calls USING GIN (pivot_moments jsonb_path_ops);
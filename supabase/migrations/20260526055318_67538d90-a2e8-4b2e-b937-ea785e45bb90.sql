
ALTER TABLE public.catastro_data
  ADD COLUMN IF NOT EXISTS fxcc_pdf_url text,
  ADD COLUMN IF NOT EXISTS fxcc_pages_urls jsonb,
  ADD COLUMN IF NOT EXISTS fxcc_num_pages integer,
  ADD COLUMN IF NOT EXISTS fxcc_disponible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fxcc_source text;

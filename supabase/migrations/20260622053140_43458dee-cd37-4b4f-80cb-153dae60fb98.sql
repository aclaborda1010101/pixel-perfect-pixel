ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS rol_owner public.owner_role,
  ADD COLUMN IF NOT EXISTS subrol_owner public.owner_subrole,
  ADD COLUMN IF NOT EXISTS rol_source text CHECK (rol_source IN ('ia','manual')),
  ADD COLUMN IF NOT EXISTS rol_confianza numeric;
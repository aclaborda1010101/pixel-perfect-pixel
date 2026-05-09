-- Buyer persona enum + column on owners
DO $$ BEGIN
  CREATE TYPE public.buyer_persona AS ENUM (
    'cansado','desplazado','controla','ego','no_traspasa','vive_edificio','no_primero','sin_clasificar'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS buyer_persona public.buyer_persona NOT NULL DEFAULT 'sin_clasificar';

CREATE INDEX IF NOT EXISTS owners_buyer_persona_idx ON public.owners (buyer_persona);
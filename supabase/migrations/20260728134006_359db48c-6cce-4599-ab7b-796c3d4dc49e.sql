ALTER TABLE public.calls DROP CONSTRAINT IF EXISTS calls_outcome_chk;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_chk CHECK (
  outcome IS NULL OR outcome = ANY (ARRAY[
    'interesado','dudoso','no_interesado','no_contestado','agente_bloqueado','otro',
    'no_interesa','volver','no_contesta'
  ])
);
-- SHIM P0.9 (declarado, sin lógica): tipos y permisos reales que el clúster
-- efímero no hereda del baseline. No reimplementa nada del pipeline.
DO $$ BEGIN
  CREATE TYPE public.nota_titular_rol AS ENUM ('pleno','usufructo','nuda_propiedad','otro','ganancial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.nota_simple_titulares
  ALTER COLUMN rol DROP DEFAULT,
  ALTER COLUMN rol TYPE public.nota_titular_rol USING rol::public.nota_titular_rol,
  ALTER COLUMN rol SET DEFAULT 'otro'::public.nota_titular_rol;

-- El worker (service_role) NO tiene acceso directo a tablas: sólo RPC.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role, anon, authenticated;
GRANT INSERT ON public.hubspot_sync_log TO service_role;
-- Inyección de fallo REAL en el finalize (rollback verificable), sin tocar lógica.
CREATE OR REPLACE FUNCTION public.p09_boom_on_finalize()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Sólo revienta en el FINALIZE real (el que marca reparse_done), nunca al
  -- armar el fixture.
  IF coalesce(OLD.structured_json->>'boom','') = '1'
     AND coalesce(NEW.structured_json->>'reparse_done','') = '1' THEN
    RAISE EXCEPTION 'p09_boom: fallo real en el finalize';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS p09_boom_trg ON public.notas_simples;
CREATE TRIGGER p09_boom_trg BEFORE UPDATE ON public.notas_simples
  FOR EACH ROW EXECUTE FUNCTION public.p09_boom_on_finalize();

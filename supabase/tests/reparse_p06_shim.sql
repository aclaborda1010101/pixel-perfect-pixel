-- SHIM P0.6: inyección de fallo REAL dentro de la transacción de
-- apply_nota_reparse_plan (paso de finalize) y permisos del worker.
-- No reimplementa nada de la lógica: sólo provoca el error.
CREATE OR REPLACE FUNCTION public.p06_boom_on_finalize()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(NEW.structured_json->>'boom','') = '1' THEN
    RAISE EXCEPTION 'p06_boom: fallo real en el finalize';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS p06_boom_trg ON public.notas_simples;
CREATE TRIGGER p06_boom_trg
  BEFORE UPDATE ON public.notas_simples
  FOR EACH ROW EXECUTE FUNCTION public.p06_boom_on_finalize();

-- El worker (service_role) NO tiene acceso directo a las tablas: sólo RPC.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_role, anon, authenticated;
GRANT INSERT ON public.hubspot_sync_log TO service_role;  -- único log auditor
GRANT EXECUTE ON FUNCTION public.match_notas_pendientes() TO service_role;
GRANT EXECUTE ON FUNCTION public.p05_set_switch(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_match_state_read() TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_mark_match_pending() TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_clear_match_pending(bigint) TO service_role;

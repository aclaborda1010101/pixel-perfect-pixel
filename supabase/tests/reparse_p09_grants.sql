-- Permisos MÍNIMOS del worker tras aplicar la cadena (las migraciones ya
-- conceden lo suyo; aquí sólo se reafirma el mínimo y se comprueba fail-closed).
GRANT EXECUTE ON FUNCTION public.reparse_claim_ids(uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_notas_pendientes() TO service_role;
GRANT EXECUTE ON FUNCTION public.p05_set_switch(text, boolean) TO service_role;
-- El worker LEE titulares (la reconciliación necesita el estado actual) pero
-- NO puede escribirlos fuera de la RPC transaccional.
GRANT SELECT ON public.nota_simple_titulares TO service_role;
GRANT SELECT ON public.notas_simples TO service_role;
DO $$
BEGIN
  IF has_table_privilege('service_role','public.nota_simple_titulares','INSERT')
     OR has_table_privilege('service_role','public.nota_simple_titulares','UPDATE')
     OR has_table_privilege('service_role','public.nota_simple_titulares','DELETE')
     OR has_table_privilege('service_role','public.notas_simples','UPDATE') THEN
    RAISE EXCEPTION 'P0.9: el worker no puede escribir fuera de la RPC transaccional';
  END IF;
  IF has_function_privilege('anon','public.apply_nota_reparse_plan(uuid, uuid, jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'P0.9: anon puede ejecutar la RPC de aplicación';
  END IF;
END $$;

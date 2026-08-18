DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    '_altas_norm','_decisiones_20260813','_excluidos_para_jesus','_flags_20260813',
    '_flags_final','_flags_fix_20260813','_lote_ed','_lote_excl','_match_20260813',
    '_notas_pedidas_20260813','_plan_altas'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=t AND c.relkind='r') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "equipo interno lee %s" ON public.%I', t, t);
      EXECUTE format(
        'CREATE POLICY "equipo interno lee %s" ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()))',
        t, t);
    END IF;
  END LOOP;
END $$;
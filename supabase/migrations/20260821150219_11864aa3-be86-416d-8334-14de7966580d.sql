CREATE TABLE IF NOT EXISTS public.backup_20260821_inmueble AS
SELECT id, direccion, refcatastral, metros_viviendas, num_viviendas,
       pct_terciario, pct_residencial, uso_principal, hs_deal_id, now() AS copiado_at
FROM public.buildings;

ALTER TABLE public.backup_20260821_inmueble ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup_inmueble_admin" ON public.backup_20260821_inmueble
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.backup_20260821_inmueble TO authenticated;
GRANT ALL ON public.backup_20260821_inmueble TO service_role;

CREATE TABLE IF NOT EXISTS public.hs_inmueble_snapshot (
  building_id uuid PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
  hs_deal_id text,
  direccion text,
  refcatastral text,
  metros_viviendas numeric,
  num_viviendas integer,
  pct_terciario numeric,
  pct_residencial numeric,
  uso_principal text,
  dealstage text,
  leido_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hs_inmueble_snapshot TO authenticated;
GRANT ALL ON public.hs_inmueble_snapshot TO service_role;
ALTER TABLE public.hs_inmueble_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs_inmueble_snapshot_lectura_interna" ON public.hs_inmueble_snapshot
  FOR SELECT TO authenticated USING (public.current_user_role() IS NOT NULL);

CREATE TRIGGER trg_hs_inmueble_snapshot_updated
  BEFORE UPDATE ON public.hs_inmueble_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DELETE FROM public.coherencia_reglas WHERE codigo IN ('inmueble_no_coincide_hubspot','terciario_escala_fraccion');

INSERT INTO public.coherencia_reglas (codigo, nombre, explicacion, sql_casos) VALUES
('inmueble_no_coincide_hubspot',
 'Datos del inmueble que no coinciden con HubSpot',
 'Viviendas, metros, terciario, residencial, referencia catastral, dirección o uso que dicen algo distinto de lo que consta en HubSpot.',
 $q$SELECT b.id,
      b.direccion || ' · no coincide: ' || array_to_string(d.difs, ', ')
    FROM public.buildings b
    JOIN public.hs_inmueble_snapshot s ON s.building_id = b.id
    CROSS JOIN LATERAL (
      SELECT array_remove(ARRAY[
        CASE WHEN s.num_viviendas IS NOT NULL AND b.num_viviendas IS DISTINCT FROM s.num_viviendas THEN 'viviendas' END,
        CASE WHEN s.metros_viviendas IS NOT NULL AND abs(coalesce(b.metros_viviendas, -1) - s.metros_viviendas) > 1 THEN 'metros' END,
        CASE WHEN s.pct_terciario IS NOT NULL AND abs(coalesce(b.pct_terciario, -1) - s.pct_terciario) > 0.5 THEN 'terciario' END,
        CASE WHEN s.pct_residencial IS NOT NULL AND abs(coalesce(b.pct_residencial, -1) - s.pct_residencial) > 0.5 THEN 'residencial' END,
        CASE WHEN s.refcatastral IS NOT NULL AND upper(coalesce(b.refcatastral, '')) <> upper(s.refcatastral) THEN 'referencia catastral' END,
        CASE WHEN s.direccion IS NOT NULL AND lower(coalesce(b.direccion, '')) <> lower(s.direccion) THEN 'dirección' END,
        CASE WHEN s.uso_principal IS NOT NULL AND lower(coalesce(b.uso_principal, '')) <> lower(s.uso_principal) THEN 'uso principal' END
      ], NULL) AS difs
    ) d
    WHERE array_length(d.difs, 1) > 0$q$),
('terciario_escala_fraccion',
 'Porcentaje de terciario guardado como fracción',
 'El terciario debe estar en tanto por ciento (20,70), no en fracción (0,2070). Si está dividido por cien, la ficha engaña.',
 $q$SELECT b.id, b.direccion || ' · terciario ' || b.pct_terciario::text
    FROM public.buildings b
    WHERE b.pct_terciario IS NOT NULL AND b.pct_terciario > 0 AND b.pct_terciario <= 1$q$);

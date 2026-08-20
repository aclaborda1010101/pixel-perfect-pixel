CREATE TABLE public.coherencia_reglas (
  codigo text PRIMARY KEY,
  nombre text NOT NULL,
  explicacion text NOT NULL,
  sql_casos text NOT NULL,
  activa boolean NOT NULL DEFAULT true,
  aceptada boolean NOT NULL DEFAULT false,
  aceptada_motivo text,
  aceptada_por uuid,
  aceptada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.coherencia_reglas TO authenticated;
GRANT ALL ON public.coherencia_reglas TO service_role;
ALTER TABLE public.coherencia_reglas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coherencia_reglas_read" ON public.coherencia_reglas FOR SELECT TO authenticated USING (true);

CREATE TABLE public.coherencia_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  codigo text NOT NULL,
  n_casos integer NOT NULL,
  medido_at timestamptz NOT NULL DEFAULT now(),
  error text
);
CREATE INDEX idx_coherencia_snapshots_codigo ON public.coherencia_snapshots(codigo, medido_at DESC);
GRANT SELECT ON public.coherencia_snapshots TO authenticated;
GRANT ALL ON public.coherencia_snapshots TO service_role;
ALTER TABLE public.coherencia_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coherencia_snapshots_read" ON public.coherencia_snapshots FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_coherencia_reglas_updated BEFORE UPDATE ON public.coherencia_reglas
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.coherencia_reglas (codigo, nombre, explicacion, sql_casos) VALUES
('personas_sin_pct_sin_etiqueta','Personas sin porcentaje y sin etiqueta','Gente ligada a un edificio que no tiene cuota ni figura como influenciador: no sabemos qué pinta ahí.',
 $q$SELECT v.building_id, v.nombre AS detalle FROM v_owner_score v WHERE v.pct_propiedad IS NULL AND COALESCE(v.es_influencer,false) = false$q$),
('edificios_sin_telefono','Edificios con propietarios pero ningún teléfono','Hay personas cargadas pero no podemos llamar a ninguna.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id=b.id) AND NOT EXISTS (SELECT 1 FROM building_owners bo JOIN owners o ON o.id=bo.owner_id WHERE bo.building_id=b.id AND COALESCE(NULLIF(trim(o.telefono),''),'') <> '')$q$),
('verificado_suma_menor_100','Verificados cuya suma no llega a 100','Damos por bueno un edificio cuyos porcentajes no cubren toda la propiedad.',
 $q$WITH s AS (SELECT building_id, COALESCE(sum(pct_propiedad) FILTER (WHERE NOT COALESCE(pct_invalido,false)),0) suma FROM v_owner_score GROUP BY 1) SELECT b.id, b.direccion||' · '||s.suma||'%' FROM buildings b JOIN s ON s.building_id=b.id WHERE b.porcentajes_estado='verificado' AND s.suma > 0 AND s.suma < 99.25$q$),
('verificado_sin_propietarios','Verificados sin ninguna persona cargada','Decimos que cuadra un edificio en el que no hay nadie.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE b.porcentajes_estado='verificado' AND NOT EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id=b.id)$q$),
('sin_comercial','Edificios sin comercial asignado','Nadie es responsable de trabajarlos.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE COALESCE(NULLIF(trim(b.comercial),''),'') = ''$q$),
('sin_asignacion_activa','Edificios sin asignación activa a ningún comercial','No aparecen en la cola de trabajo de nadie.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE NOT EXISTS (SELECT 1 FROM building_assignments a WHERE a.building_id=b.id AND a.status='active')$q$),
('notas_error','Notas simples con error de lectura','El PDF no se pudo interpretar, así que faltan titulares.',
 $q$SELECT n.building_id, COALESCE(n.error_message,'error de lectura') FROM notas_simples n WHERE n.status='error'$q$),
('sin_propietarios_con_propietarios','Marcados «sin propietarios» que sí los tienen','El estado contradice a los datos.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE b.porcentajes_estado='sin_propietarios' AND EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id=b.id)$q$),
('suma_mayor_100','Suma de propiedad superior a 100','Un edificio no puede tener más del 100 % repartido.',
 $q$WITH s AS (SELECT building_id, COALESCE(sum(pct_propiedad) FILTER (WHERE NOT COALESCE(pct_invalido,false)),0) suma FROM v_owner_score GROUP BY 1) SELECT b.id, b.direccion||' · '||s.suma||'%' FROM buildings b JOIN s ON s.building_id=b.id WHERE s.suma > 100.75$q$),
('verificado_sin_porcentaje','Verificados sin ningún porcentaje','Verificado pero no mostramos ni una cuota.',
 $q$WITH s AS (SELECT building_id, COALESCE(sum(pct_propiedad) FILTER (WHERE NOT COALESCE(pct_invalido,false)),0) suma FROM v_owner_score GROUP BY 1) SELECT b.id, b.direccion FROM buildings b JOIN s ON s.building_id=b.id WHERE b.porcentajes_estado='verificado' AND s.suma = 0$q$),
('persona_duplicada','Persona duplicada en el mismo edificio','La misma persona aparece dos veces y sus porcentajes se cuentan doble.',
 $q$SELECT bo.building_id, bo.owner_name_norm FROM building_owners bo WHERE bo.owner_name_norm IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1$q$),
('propietario_sin_nombre','Propietario sin nombre','Una ficha sin nombre no se puede trabajar.',
 $q$SELECT bo.building_id, 'ficha sin nombre' FROM building_owners bo JOIN owners o ON o.id=bo.owner_id WHERE COALESCE(NULLIF(trim(o.nombre),''),'') = ''$q$),
('interlocutor_no_propietario','Interlocutor marcado que no es propietario','Estamos hablando con alguien que no consta en el edificio.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE b.interlocutor_owner_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id=b.id AND bo.owner_id=b.interlocutor_owner_id)$q$),
('llamadas_sin_propietario','Llamadas sin propietario asociado','No sabemos a quién se llamó, así que no cuenta como contacto.',
 $q$SELECT NULL::uuid, COALESCE(c.direccion,'llamada '||c.id::text) FROM calls c WHERE c.owner_id IS NULL$q$),
('tareas_sin_propietarios','Tareas abiertas en edificios sin propietarios','Pedimos trabajo imposible: no hay a quién llamar.',
 $q$SELECT t.building_id, t.title FROM building_tasks t WHERE t.status IN ('pending','in_progress') AND NOT EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id=t.building_id)$q$),
('sin_negocio_hubspot','Edificio sin negocio vinculado en HubSpot','Sin negocio no se sincroniza nada con el CRM.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE b.hs_deal_id IS NULL$q$),
('hubspot_mas_contactos','HubSpot tiene más contactos que nosotros','En el CRM hay gente asociada al edificio que aquí no está cargada.',
 $q$SELECT b.id, b.direccion||' · faltan '||(jsonb_array_length(COALESCE(d.associated_contact_ids,'[]'::jsonb)) - (SELECT count(*) FROM building_owners bo WHERE bo.building_id=b.id))::text FROM buildings b JOIN hubspot_deals d ON d.hs_id = b.hs_deal_id::text WHERE jsonb_array_length(COALESCE(d.associated_contact_ids,'[]'::jsonb)) > (SELECT count(*) FROM building_owners bo WHERE bo.building_id=b.id)$q$),
('pct_difiere_hubspot','Porcentajes que difieren de HubSpot','Nuestra cuota no coincide con la del CRM para la misma persona.',
 $q$SELECT c.building_id, o.nombre||' · HubSpot '||c.pct_hubspot::text||'% / aquí '||COALESCE(bo.cuota::text,'sin cuota') FROM v_owner_pct_crm c JOIN building_owners bo ON bo.building_id=c.building_id AND bo.owner_id=c.owner_id JOIN owners o ON o.id=c.owner_id WHERE c.pct_hubspot IS NOT NULL AND bo.cuota IS NOT NULL AND abs(round(c.pct_hubspot,2) - round(bo.cuota::numeric,2)) > 0.75$q$),
('telefono_solo_en_hubspot','Personas con teléfono en HubSpot y sin teléfono aquí','Podríamos llamarles y no lo sabemos.',
 $q$SELECT bo.building_id, o.nombre FROM building_owners bo JOIN owners o ON o.id=bo.owner_id WHERE COALESCE(NULLIF(trim(o.telefono),''),'') = '' AND COALESCE(NULLIF(trim(o.metadatos->>'phone'),''),'') <> ''$q$),
('inmueble_difiere_hubspot','Datos del inmueble que difieren de HubSpot','Catastro, viviendas o terciario no coinciden con el CRM.',
 $q$SELECT b.id, b.direccion FROM buildings b WHERE b.metadatos IS NOT NULL AND (
   (NULLIF(trim(b.metadatos->>'referencia_catastral'),'') IS NOT NULL AND NULLIF(trim(COALESCE(b.refcatastral,b.catastro_ref,'')),'') IS NOT NULL AND upper(trim(b.metadatos->>'referencia_catastral')) <> upper(trim(COALESCE(b.refcatastral,b.catastro_ref))))
   OR (b.numero_propietarios IS NOT NULL AND (b.metadatos->>'num_associated_contacts') ~ '^[0-9]+$' AND b.numero_propietarios <> (b.metadatos->>'num_associated_contacts')::int)
 )$q$),
('titulares_sin_ficha','Titulares de nota simple sin ficha de contacto','Aparecen en la nota registral pero no existen como personas.',
 $q$SELECT t.building_id, COALESCE(t.direccion, t.building_id::text) FROM v_building_titulares_sin_ficha t$q$),
('usufructo_como_propiedad','Usufructos contados como propiedad','El usufructo no es propiedad: si suma, inflamos la cuota.',
 $q$SELECT c.building_id, o.nombre||' · '||COALESCE(c.derecho_raw,'usufructo') FROM v_owner_pct_crm c JOIN building_owners bo ON bo.building_id=c.building_id AND bo.owner_id=c.owner_id JOIN owners o ON o.id=c.owner_id WHERE 'usu' = ANY (derecho_grupos(c.derecho_raw)) AND NOT derecho_computa_propiedad(c.derecho_raw) AND COALESCE(bo.cuota,0) > 0$q$),
('ganancial_duplicado','Cónyuges en gananciales contados dos veces','El CRM repite el 100 % en cada cónyuge; es una sola propiedad.',
 $q$SELECT c.building_id, o.nombre||' · ganancial '||COALESCE(c.pct_hubspot::text,'')||'%' FROM v_owner_pct_crm c JOIN owners o ON o.id=c.owner_id WHERE c.regla LIKE '%ganancial_compartido%'$q$);

CREATE OR REPLACE FUNCTION public.coherencia_casos(p_codigo text, p_limite integer DEFAULT 500)
RETURNS TABLE(building_id uuid, detalle text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_sql text;
BEGIN
  IF NOT (public.current_user_has_role('admin') OR public.current_user_has_role('sales_manager')) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  SELECT r.sql_casos INTO v_sql FROM public.coherencia_reglas r WHERE r.codigo = p_codigo AND r.activa;
  IF v_sql IS NULL THEN RETURN; END IF;
  RETURN QUERY EXECUTE format('SELECT x.building_id, x.detalle FROM (%s) AS x(building_id, detalle) LIMIT %s', v_sql, greatest(1, least(p_limite, 2000)));
END;
$$;
REVOKE ALL ON FUNCTION public.coherencia_casos(text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coherencia_casos(text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.coherencia_evaluar()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; v_run uuid := gen_random_uuid(); v_n integer; v_err text;
BEGIN
  FOR r IN SELECT * FROM public.coherencia_reglas WHERE activa ORDER BY codigo LOOP
    v_n := NULL; v_err := NULL;
    BEGIN
      EXECUTE format('SELECT count(*) FROM (%s) AS x(building_id, detalle)', r.sql_casos) INTO v_n;
    EXCEPTION WHEN OTHERS THEN v_n := -1; v_err := SQLERRM;
    END;
    INSERT INTO public.coherencia_snapshots(run_id, codigo, n_casos, error) VALUES (v_run, r.codigo, v_n, v_err);
  END LOOP;
  RETURN jsonb_build_object('run_id', v_run, 'reglas', (SELECT count(*) FROM public.coherencia_snapshots WHERE run_id = v_run));
END;
$$;
REVOKE ALL ON FUNCTION public.coherencia_evaluar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coherencia_evaluar() TO authenticated;

CREATE OR REPLACE FUNCTION public.coherencia_resumen()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.current_user_has_role('admin') OR public.current_user_has_role('sales_manager')) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  WITH ult AS (
    SELECT DISTINCT ON (codigo) codigo, n_casos, medido_at, error, run_id
    FROM public.coherencia_snapshots ORDER BY codigo, medido_at DESC
  ), hist AS (
    SELECT codigo, jsonb_agg(jsonb_build_object('n', n_casos, 'at', medido_at) ORDER BY medido_at DESC) AS serie
    FROM (SELECT codigo, n_casos, medido_at, row_number() OVER (PARTITION BY codigo ORDER BY medido_at DESC) rn FROM public.coherencia_snapshots) s
    WHERE rn <= 10 GROUP BY codigo
  )
  SELECT jsonb_build_object(
    'medido_at', (SELECT max(medido_at) FROM ult),
    'total_incumplimientos', COALESCE((SELECT sum(GREATEST(u.n_casos,0)) FROM ult u JOIN public.coherencia_reglas r ON r.codigo=u.codigo WHERE r.activa AND NOT r.aceptada),0),
    'reglas_en_cero', COALESCE((SELECT count(*) FROM ult u JOIN public.coherencia_reglas r ON r.codigo=u.codigo WHERE r.activa AND u.n_casos = 0),0),
    'reglas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'codigo', r.codigo, 'nombre', r.nombre, 'explicacion', r.explicacion,
        'n_casos', COALESCE(u.n_casos, -1), 'error', u.error,
        'aceptada', r.aceptada, 'aceptada_motivo', r.aceptada_motivo,
        'medido_at', u.medido_at, 'historico', COALESCE(h.serie,'[]'::jsonb))
      ORDER BY COALESCE(u.n_casos,0) DESC)
      FROM public.coherencia_reglas r LEFT JOIN ult u ON u.codigo=r.codigo LEFT JOIN hist h ON h.codigo=r.codigo
      WHERE r.activa), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.coherencia_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coherencia_resumen() TO authenticated;

CREATE OR REPLACE FUNCTION public.coherencia_aceptar_regla(p_codigo text, p_aceptada boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.current_user_has_role('admin') OR public.current_user_has_role('sales_manager')) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  IF p_aceptada AND COALESCE(trim(p_motivo),'') = '' THEN
    RAISE EXCEPTION 'hace falta un motivo para aceptar una regla';
  END IF;
  UPDATE public.coherencia_reglas
     SET aceptada = p_aceptada,
         aceptada_motivo = CASE WHEN p_aceptada THEN p_motivo ELSE NULL END,
         aceptada_por = CASE WHEN p_aceptada THEN auth.uid() ELSE NULL END,
         aceptada_at = CASE WHEN p_aceptada THEN now() ELSE NULL END
   WHERE codigo = p_codigo;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;
REVOKE ALL ON FUNCTION public.coherencia_aceptar_regla(text,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coherencia_aceptar_regla(text,boolean,text) TO authenticated;

DO $do$
BEGIN
  PERFORM cron.unschedule('coherencia_nocturna');
EXCEPTION WHEN OTHERS THEN NULL;
END;
$do$;
SELECT cron.schedule('coherencia_nocturna', '15 3 * * *', $c$SELECT public.coherencia_evaluar();$c$);
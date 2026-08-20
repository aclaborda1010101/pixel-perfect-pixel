-- =========================================================
-- COTEJO HUBSPOT: campos nuevos de edificio
-- =========================================================
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS metros_viviendas numeric,
  ADD COLUMN IF NOT EXISTS num_viviendas integer,
  ADD COLUMN IF NOT EXISTS pct_residencial numeric,
  ADD COLUMN IF NOT EXISTS uso_principal text,
  ADD COLUMN IF NOT EXISTS hs_props_synced_at timestamptz;

-- =========================================================
-- Incidencias del cotejo (revisión humana)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.cotejo_hubspot_incidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'abierta',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cotejo_hubspot_incidencias TO authenticated;
GRANT ALL ON public.cotejo_hubspot_incidencias TO service_role;
ALTER TABLE public.cotejo_hubspot_incidencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cotejo_read_auth" ON public.cotejo_hubspot_incidencias;
CREATE POLICY "cotejo_read_auth" ON public.cotejo_hubspot_incidencias
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "cotejo_write_admin" ON public.cotejo_hubspot_incidencias;
CREATE POLICY "cotejo_write_admin" ON public.cotejo_hubspot_incidencias
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales_manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales_manager'::app_role));

CREATE INDEX IF NOT EXISTS idx_cotejo_inc_tipo ON public.cotejo_hubspot_incidencias (tipo, estado);
CREATE INDEX IF NOT EXISTS idx_cotejo_inc_building ON public.cotejo_hubspot_incidencias (building_id);

DROP TRIGGER IF EXISTS trg_cotejo_inc_updated ON public.cotejo_hubspot_incidencias;
CREATE TRIGGER trg_cotejo_inc_updated BEFORE UPDATE ON public.cotejo_hubspot_incidencias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Clave de fusión de personas (ignora DON/DOÑA, tildes, orden de apellidos)
-- =========================================================
CREATE OR REPLACE FUNCTION public.person_merge_key(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    array_to_string(
      ARRAY(
        SELECT DISTINCT t FROM unnest(
          string_to_array(
            regexp_replace(
              lower(translate(coalesce(p,''),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiioooooouuuuncaaaaaeeeeiiiioooooouuuunc')),
              '[^a-z0-9 ]+', ' ', 'g'
            ), ' '
          )
        ) AS t
        WHERE length(t) > 1
          AND t NOT IN ('don','dona','doua','dna','sr','sra','srta','hros','herederos','sres','sucesores')
        ORDER BY t
      ), ' '
    ), ''
  );
$$;

-- =========================================================
-- CAUSA 1 — fusión de duplicados de persona
-- =========================================================
CREATE OR REPLACE FUNCTION public.fusionar_duplicados_propietarios(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp record;
  v_loser uuid;
  v_grupos int := 0;
  v_fusionados int := 0;
  v_ambiguos int := 0;
BEGIN
  FOR grp IN
    WITH n AS (
      SELECT o.id, o.nombre, o.created_at,
             public.person_merge_key(o.nombre) AS k,
             (o.metadatos ? 'tipo_de_derecho') AS tiene_hs,
             (SELECT e.provider_id FROM public.external_ids e
               WHERE e.entity_type='owner' AND e.entity_id=o.id AND e.provider='hubspot' LIMIT 1) AS hs_id
      FROM public.owners o
      WHERE o.merged_into IS NULL
    )
    SELECT k,
           array_agg(id ORDER BY tiene_hs DESC, created_at ASC) AS ids,
           array_agg(nombre ORDER BY tiene_hs DESC, created_at ASC) AS nombres,
           count(DISTINCT hs_id) FILTER (WHERE hs_id IS NOT NULL) AS n_hs
    FROM n
    WHERE k IS NOT NULL AND k <> ''
    GROUP BY k
    HAVING count(*) > 1
  LOOP
    v_grupos := v_grupos + 1;

    -- Ambiguo: dos o más fichas distintas de HubSpot con el mismo nombre normalizado.
    -- No se fusiona nunca: mejor duplicado que fusión equivocada.
    IF grp.n_hs > 1 THEN
      v_ambiguos := v_ambiguos + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.cotejo_hubspot_incidencias (tipo, titulo, detalle)
        VALUES ('duplicado_ambiguo',
                'Posible duplicado con varias fichas de HubSpot: ' || grp.nombres[1],
                jsonb_build_object('clave', grp.k, 'owner_ids', grp.ids, 'nombres', grp.nombres));
      END IF;
      CONTINUE;
    END IF;

    FOREACH v_loser IN ARRAY grp.ids[2:array_length(grp.ids,1)] LOOP
      v_fusionados := v_fusionados + 1;
      IF NOT p_dry_run THEN
        PERFORM public._merge_owner_pair(grp.ids[1], v_loser, 'cotejo_hubspot_duplicado_grafia',
                 jsonb_build_object('clave', grp.k));
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'grupos', v_grupos,
                            'fusionados', v_fusionados, 'ambiguos_a_revision', v_ambiguos);
END;
$$;

-- =========================================================
-- CAUSA 3 — el tipo de derecho de HubSpot manda
-- =========================================================
CREATE OR REPLACE FUNCTION public.reclasificar_por_tipo_derecho()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a_influencer int := 0;
  v_a_propietario int := 0;
BEGIN
  WITH objetivo AS (
    SELECT bo.building_id, bo.owner_id,
           o.metadatos->>'tipo_de_derecho' AS d,
           (public.normalize_pct_propiedad(o.metadatos->>'porcentaje_de_participacion')).pct AS pct
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
    WHERE COALESCE(o.metadatos->>'tipo_de_derecho','') <> ''
  ), decidido AS (
    SELECT building_id, owner_id, d, pct,
           NOT public.derecho_computa_propiedad(d)
             AND NOT ('usu' = ANY(public.derecho_grupos(d))) AS debe_influencer,
           public.derecho_computa_propiedad(d) AS debe_propietario
    FROM objetivo
  ), upd AS (
    UPDATE public.building_owners bo
       SET es_influencer = dec.debe_influencer,
           influencer_reason = CASE WHEN dec.debe_influencer
             THEN 'HubSpot lo clasifica como «' || dec.d || '», no como propietario'
             ELSE bo.influencer_reason END,
           cuota = CASE WHEN dec.debe_propietario THEN COALESCE(dec.pct, bo.cuota)
                        WHEN dec.debe_influencer THEN NULL
                        ELSE bo.cuota END
      FROM decidido dec
     WHERE bo.building_id = dec.building_id
       AND bo.owner_id = dec.owner_id
       AND (bo.es_influencer IS DISTINCT FROM dec.debe_influencer
            OR (dec.debe_propietario AND dec.pct IS NOT NULL AND bo.cuota IS DISTINCT FROM dec.pct))
    RETURNING dec.debe_influencer
  )
  SELECT count(*) FILTER (WHERE debe_influencer), count(*) FILTER (WHERE NOT debe_influencer)
    INTO v_a_influencer, v_a_propietario
  FROM upd;

  RETURN jsonb_build_object('a_influenciador', v_a_influencer, 'a_propietario', v_a_propietario);
END;
$$;

-- =========================================================
-- CAUSA 5 — propietarios fantasma (sin persona real detrás)
-- =========================================================
CREATE OR REPLACE FUNCTION public.limpiar_propietarios_fantasma(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  CREATE TEMP TABLE _fantasmas ON COMMIT DROP AS
  SELECT bo.building_id, bo.owner_id, o.nombre, b.direccion
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE lower(o.nombre) ~ '^(propietario|propietarios|titular|titulares|desconocido|sin nombre)\b'
     OR public.person_merge_key(o.nombre) = public.person_merge_key(b.direccion);

  SELECT count(*) INTO v_n FROM _fantasmas;

  IF NOT p_dry_run THEN
    INSERT INTO public.cotejo_hubspot_incidencias (building_id, tipo, titulo, detalle)
    SELECT f.building_id, 'propietario_fantasma',
           'Registro de propietario sin persona real: ' || f.nombre,
           jsonb_build_object('owner_id', f.owner_id, 'nombre', f.nombre, 'direccion', f.direccion)
      FROM _fantasmas f;

    UPDATE public.owners o
       SET metadatos = COALESCE(o.metadatos,'{}'::jsonb) || jsonb_build_object('fantasma', true, 'fantasma_at', now())
      FROM _fantasmas f WHERE o.id = f.owner_id;

    DELETE FROM public.building_owners bo
     USING _fantasmas f
     WHERE bo.building_id = f.building_id AND bo.owner_id = f.owner_id;
  END IF;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'fantasmas', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.fusionar_duplicados_propietarios(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reclasificar_por_tipo_derecho() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.limpiar_propietarios_fantasma(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fusionar_duplicados_propietarios(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reclasificar_por_tipo_derecho() TO service_role;
GRANT EXECUTE ON FUNCTION public.limpiar_propietarios_fantasma(boolean) TO service_role;
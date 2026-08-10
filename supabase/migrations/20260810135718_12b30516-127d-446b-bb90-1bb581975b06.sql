
-- =====================================================================
-- FASE 2 · PRIORIDAD 0 — Porcentajes y derechos con evidencia
-- =====================================================================

-- 1) Normalizador de nombres (idempotente, sin acentos, sin ruido)
CREATE OR REPLACE FUNCTION public.norm_person_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p,''),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
          'AAAAAEEEEIIIIOOOOOUUUUNCAAAAAEEEEIIIIOOOOOUUUUNC')),
        '\m(DON|DONA|DOÑA|SR|SRA|D)\M\.?', ' ', 'g'),
      '[^A-Z0-9]+', ' ', 'g')
  , '');
$$;

-- 2) Ampliación de building_property_rights
ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS titular_id      uuid REFERENCES public.nota_simple_titulares(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS titular_nombre  text,
  ADD COLUMN IF NOT EXISTS titular_dni     text,
  ADD COLUMN IF NOT EXISTS identity_match  text NOT NULL DEFAULT 'ninguno',
  ADD COLUMN IF NOT EXISTS cotitulares     text[],
  ADD COLUMN IF NOT EXISTS feeds_cuota     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocked_reason  text;

ALTER TABLE public.building_property_rights DROP CONSTRAINT IF EXISTS building_property_rights_right_type_check;
ALTER TABLE public.building_property_rights
  ADD CONSTRAINT building_property_rights_right_type_check
  CHECK (right_type IN ('pleno_dominio','nuda_propiedad','usufructo','ganancial','otro'));

ALTER TABLE public.building_property_rights DROP CONSTRAINT IF EXISTS building_property_rights_identity_match_check;
ALTER TABLE public.building_property_rights
  ADD CONSTRAINT building_property_rights_identity_match_check
  CHECK (identity_match IN ('dni','nombre_exacto','aproximado','ninguno'));

CREATE INDEX IF NOT EXISTS idx_bpr_building_layer ON public.building_property_rights(building_id, right_type);
CREATE INDEX IF NOT EXISTS idx_bpr_nota ON public.building_property_rights(note_simple_id);

-- 3) Copia de seguridad completa antes de reconstruir (reversible)
CREATE TABLE IF NOT EXISTS public.building_property_rights_archive (
  archive_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archived_at timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL,
  row_data    jsonb NOT NULL
);
GRANT SELECT ON public.building_property_rights_archive TO authenticated;
GRANT ALL ON public.building_property_rights_archive TO service_role;
ALTER TABLE public.building_property_rights_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpra_read ON public.building_property_rights_archive;
CREATE POLICY bpra_read ON public.building_property_rights_archive
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- 4) Reconstrucción canónica desde nota_simple_titulares
CREATE OR REPLACE FUNCTION public.p0_rebuild_property_rights(p_reason text DEFAULT 'fase2_p0')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_arch int; v_ins int;
BEGIN
  INSERT INTO public.building_property_rights_archive(reason, row_data)
  SELECT p_reason, to_jsonb(r) FROM public.building_property_rights r;
  GET DIAGNOSTICS v_arch = ROW_COUNT;

  DELETE FROM public.building_property_rights;

  WITH tit AS (
    SELECT t.id AS titular_id,
           ns.id AS nota_id,
           ns.building_id,
           t.nombre_extraido,
           nullif(upper(regexp_replace(coalesce(t.cif_dni,''),'[^A-Za-z0-9]','','g')),'') AS dni,
           t.porcentaje,
           t.rol::text AS rol,
           t.company_id,
           public.norm_person_name(t.nombre_extraido) AS nn
    FROM public.nota_simple_titulares t
    JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
    WHERE ns.building_id IS NOT NULL
  ),
  clasif AS (
    SELECT tit.*,
      CASE
        WHEN tit.nombre_extraido ~* '(SOCIEDAD\s+CONYUGAL|GANANCIAL)' THEN 'ganancial'
        WHEN tit.rol = 'pleno' THEN 'pleno_dominio'
        WHEN tit.rol IN ('nuda_propiedad','usufructo') THEN tit.rol
        ELSE 'otro'
      END AS right_type,
      CASE WHEN tit.nombre_extraido ~* '(SOCIEDAD\s+CONYUGAL|GANANCIAL)' THEN 'gananciales' END AS regimen,
      CASE WHEN tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|CAPITAL)\M'
                OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]'
           THEN true ELSE false END AS es_sociedad
    FROM tit
  ),
  -- identidad por DNI (inequívoca solo si un único owner coincide)
  m_dni AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o
      ON nullif(upper(regexp_replace(coalesce(o.metadatos->>'dni__nif__cif',''),'[^A-Za-z0-9]','','g')),'') = c.dni
    WHERE c.dni IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_nom AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o ON public.norm_person_name(o.nombre) = c.nn
    WHERE c.nn IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_comp AS (
    SELECT c.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
    FROM clasif c
    JOIN public.companies k ON public.norm_person_name(k.nombre) = c.nn
    WHERE c.es_sociedad AND c.nn IS NOT NULL
    GROUP BY c.titular_id
  )
  INSERT INTO public.building_property_rights (
    building_id, owner_id, company_id, note_simple_id, titular_id, titular_nombre, titular_dni,
    right_type, percentage, coownership_regime, cotitulares,
    source_type, source_ref, evidence, identity_match, confidence, status
  )
  SELECT
    c.building_id,
    CASE WHEN NOT c.es_sociedad THEN
      CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id ELSE NULL END
    END,
    CASE WHEN c.es_sociedad THEN coalesce(c.company_id, CASE WHEN mc.n = 1 THEN mc.company_id END) ELSE c.company_id END,
    c.nota_id,
    c.titular_id,
    c.nombre_extraido,
    c.dni,
    c.right_type,
    c.porcentaje,
    c.regimen,
    CASE WHEN c.regimen = 'gananciales'
         THEN (SELECT array_agg(btrim(x)) FROM unnest(regexp_split_to_array(
                 regexp_replace(c.nombre_extraido, '\s*\((SOCIEDAD\s+CONYUGAL|GANANCIALES?)\)\s*', '', 'gi'),
                 '\s+Y\s+')) x WHERE btrim(x) <> '')
    END,
    'nota_simple',
    'titular:' || c.titular_id::text || '|nota:' || c.nota_id::text,
    'Nota simple ' || c.nota_id::text || ' · titular literal: "' || c.nombre_extraido ||
      '" · derecho: ' || c.right_type || ' · porcentaje declarado: ' || coalesce(c.porcentaje::text,'(sin dato)'),
    CASE
      WHEN c.es_sociedad THEN CASE WHEN c.company_id IS NOT NULL OR mc.n = 1 THEN 'nombre_exacto' ELSE 'ninguno' END
      WHEN md.n = 1 THEN 'dni'
      WHEN mn.n = 1 THEN 'nombre_exacto'
      WHEN md.n > 1 OR mn.n > 1 THEN 'aproximado'
      ELSE 'ninguno'
    END,
    CASE WHEN md.n = 1 THEN 1.0 WHEN mn.n = 1 THEN 0.8 ELSE 0.4 END,
    'active'
  FROM clasif c
  LEFT JOIN m_dni md ON md.titular_id = c.titular_id
  LEFT JOIN m_nom mn ON mn.titular_id = c.titular_id
  LEFT JOIN m_comp mc ON mc.titular_id = c.titular_id;

  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN jsonb_build_object('archivadas', v_arch, 'insertadas', v_ins);
END;
$$;
REVOKE ALL ON FUNCTION public.p0_rebuild_property_rights(text) FROM PUBLIC, anon, authenticated;

-- 5) Control por capa (NUNCA suma capas distintas entre sí)
CREATE OR REPLACE VIEW public.v_rights_layer_check AS
SELECT r.building_id,
       r.note_simple_id,
       r.right_type,
       count(*)                                   AS n_titulares,
       round(sum(coalesce(r.percentage,0)),2)     AS suma_capa,
       bool_and(r.percentage IS NOT NULL)         AS todos_con_pct,
       (abs(sum(coalesce(r.percentage,0)) - 100) <= 0.5
        AND bool_and(r.percentage IS NOT NULL))   AS capa_100
FROM public.building_property_rights r
WHERE r.status = 'active'
GROUP BY r.building_id, r.note_simple_id, r.right_type;

-- 6) Estado por edificio: bloqueos y elegibilidad para cuota
CREATE OR REPLACE VIEW public.v_building_rights_status AS
WITH notas AS (
  SELECT building_id, count(DISTINCT note_simple_id) AS n_notas
  FROM public.building_property_rights WHERE status='active' GROUP BY building_id
),
capas AS (
  SELECT building_id,
         bool_and(capa_100)                                            AS todas_capas_100,
         count(*) FILTER (WHERE NOT capa_100)                          AS capas_malas,
         jsonb_agg(jsonb_build_object('nota',note_simple_id,'capa',right_type,
                                      'suma',suma_capa,'ok',capa_100)) AS detalle_capas
  FROM public.v_rights_layer_check GROUP BY building_id
),
-- contradicción: dos notas distintas declaran pleno dominio con conjuntos de titulares distintos
pleno_por_nota AS (
  SELECT building_id, note_simple_id,
         md5(string_agg(coalesce(public.norm_person_name(titular_nombre),''), '|' ORDER BY public.norm_person_name(titular_nombre))) AS firma
  FROM public.building_property_rights
  WHERE status='active' AND right_type IN ('pleno_dominio','ganancial')
  GROUP BY building_id, note_simple_id
),
contra AS (
  SELECT building_id, count(DISTINCT firma) AS firmas, count(*) AS notas_pleno
  FROM pleno_por_nota GROUP BY building_id
),
ident AS (
  SELECT building_id,
         count(*) FILTER (WHERE identity_match='ninguno')     AS sin_identidad,
         count(*) FILTER (WHERE identity_match='aproximado')  AS identidad_ambigua
  FROM public.building_property_rights WHERE status='active' GROUP BY building_id
)
SELECT b.id AS building_id,
       b.direccion,
       coalesce(n.n_notas,0)          AS n_notas,
       coalesce(c.todas_capas_100,false) AS todas_capas_100,
       coalesce(c.capas_malas,0)      AS capas_malas,
       c.detalle_capas,
       coalesce(x.firmas,0)           AS firmas_pleno,
       coalesce(i.sin_identidad,0)    AS sin_identidad,
       coalesce(i.identidad_ambigua,0) AS identidad_ambigua,
       (ARRAY_REMOVE(ARRAY[
          CASE WHEN coalesce(n.n_notas,0)=0 THEN 'sin_nota_con_titulares' END,
          CASE WHEN coalesce(c.capas_malas,0)>0 THEN 'capa_no_suma_100' END,
          CASE WHEN coalesce(x.firmas,0)>1 THEN 'contradiccion_entre_notas' END,
          CASE WHEN coalesce(i.identidad_ambigua,0)>0 THEN 'identidad_ambigua' END
        ], NULL))                     AS bloqueos,
       (coalesce(n.n_notas,0)>0
        AND coalesce(c.todas_capas_100,false)
        AND coalesce(x.firmas,0)<=1
        AND coalesce(i.identidad_ambigua,0)=0) AS apto_para_cuota
FROM public.buildings b
LEFT JOIN notas n ON n.building_id=b.id
LEFT JOIN capas c ON c.building_id=b.id
LEFT JOIN contra x ON x.building_id=b.id
LEFT JOIN ident i ON i.building_id=b.id;

-- 7) Solo estos porcentajes pueden alimentar cuota operativa / scoring
CREATE OR REPLACE VIEW public.v_rights_cuota_eligible AS
SELECT r.building_id, r.owner_id, r.percentage AS pct_pleno, r.note_simple_id, r.titular_id, r.evidence
FROM public.building_property_rights r
JOIN public.v_building_rights_status s ON s.building_id = r.building_id
WHERE r.status='active'
  AND r.right_type = 'pleno_dominio'
  AND r.identity_match = 'dni'
  AND r.owner_id IS NOT NULL
  AND s.apto_para_cuota;

-- 8) Marca feeds_cuota / blocked_reason de forma trazable
CREATE OR REPLACE FUNCTION public.p0_mark_cuota_eligibility()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  UPDATE public.building_property_rights r
  SET feeds_cuota = false,
      blocked_reason = NULLIF(array_to_string(s.bloqueos, ', '), '')
  FROM public.v_building_rights_status s
  WHERE s.building_id = r.building_id;

  UPDATE public.building_property_rights r
  SET feeds_cuota = true, blocked_reason = NULL
  FROM public.v_rights_cuota_eligible e
  WHERE e.titular_id = r.titular_id;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN jsonb_build_object('feeds_cuota', v);
END;
$$;
REVOKE ALL ON FUNCTION public.p0_mark_cuota_eligibility() FROM PUBLIC, anon, authenticated;

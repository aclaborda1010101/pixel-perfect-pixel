-- 1) Titularidad registral: sumas por capa de derecho (no mezclar roles)
DROP VIEW IF EXISTS public.v_titularidad_registral;
CREATE VIEW public.v_titularidad_registral AS
WITH nota_principal AS (
  SELECT DISTINCT ON (n.building_id) n.building_id, n.id AS nota_id, n.structured_json, n.created_at
  FROM notas_simples n
  WHERE n.building_id IS NOT NULL AND n.status = 'listo'
  ORDER BY n.building_id,
    (SELECT count(*) FROM nota_simple_titulares t1 WHERE t1.nota_simple_id = n.id AND t1.porcentaje IS NOT NULL) DESC,
    n.created_at DESC
), tit AS (
  SELECT np.building_id, np.nota_id,
    (np.structured_json ->> 'fecha_emision_nota') AS fecha_emision_nota,
    t.id AS titular_id, t.nombre_extraido, t.cif_dni, t.porcentaje,
    COALESCE(NULLIF((t.rol)::text, ''), 'otro') AS rol,
    ((COALESCE(t.company_id, NULL::uuid) IS NOT NULL)
      OR (t.cif_dni ~* '^[ABCDEFGHJNPQRSUVW]')
      OR (normalize_person_name(t.nombre_extraido) ~ '(^| )(SL|SA|SLU|SAU|SOCIEDAD|INVERSIONES|PATRIMONIO|PATRIMONIAL|INMOBILIARIA)( |$)')) AS es_sociedad,
    EXISTS (
      SELECT 1 FROM building_owners bo
      WHERE bo.building_id = np.building_id
        AND (bo.owner_name_norm = normalize_person_name(t.nombre_extraido)
             OR (person_match_key(t.nombre_extraido) IS NOT NULL
                 AND person_match_key(bo.owner_name_norm) = person_match_key(t.nombre_extraido)))
    ) AS tiene_contacto_crm
  FROM nota_principal np
  JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id
), capa AS (
  SELECT building_id, nota_id, rol,
    sum(porcentaje) AS suma_capa,
    count(*)::int AS n_capa,
    count(*) FILTER (WHERE porcentaje IS NOT NULL)::int AS n_capa_con_pct
  FROM tit GROUP BY building_id, nota_id, rol
)
SELECT t.building_id, t.nota_id, t.fecha_emision_nota, t.titular_id, t.nombre_extraido,
       t.cif_dni, t.porcentaje, t.rol, t.es_sociedad, t.tiene_contacto_crm,
       c.suma_capa, c.n_capa, c.n_capa_con_pct,
       (c.n_capa_con_pct > 0 AND c.suma_capa >= 99 AND c.suma_capa <= 101) AS capa_completa
FROM tit t
JOIN capa c ON c.building_id = t.building_id AND c.nota_id = t.nota_id AND c.rol = t.rol;

GRANT SELECT ON public.v_titularidad_registral TO authenticated;
GRANT SELECT ON public.v_titularidad_registral TO service_role;

-- 2) Candidatos V5: gate por derechos verificados, nunca por suma plana de building_owners.cuota
DROP VIEW IF EXISTS public.v_v5_task_candidates;
CREATE VIEW public.v_v5_task_candidates AS
WITH base AS (
  SELECT bo.building_id, bo.owner_id, o.nombre, o.telefono, o.email,
    (o.rol)::text AS rol, (o.buyer_persona)::text AS buyer_persona,
    o.fecha_nacimiento, o.edad_anios, COALESCE(o.estado_vital, 'activo') AS estado_vital,
    o.consentimiento, bo.cuota, bo.rol_notas, b.direccion, b.comercial,
    COALESCE(b.score_total, b.score, 0::numeric) AS score
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN buildings b ON b.id = bo.building_id
), cl AS (
  SELECT owner_id, count(*)::int AS n_calls, max(fecha) AS last_fecha FROM calls GROUP BY owner_id
), lo AS (
  SELECT DISTINCT ON (owner_id) owner_id, outcome AS last_outcome, fecha AS last_outcome_fecha
  FROM calls WHERE outcome IS NOT NULL ORDER BY owner_id, fecha DESC
), cons AS (
  SELECT DISTINCT ON (owner_id) owner_id, veredicto, cita_textual,
    COALESCE(fecha_llamada, detectado_at) AS senal_fecha
  FROM wa_consent_signals ORDER BY owner_id, COALESCE(fecha_llamada, detectado_at) DESC
), wa AS (
  SELECT owner_id, max(COALESCE(enviado_at, created_at)) AS last_wa FROM whatsapp_messages GROUP BY owner_id
), na AS (
  SELECT owner_id, min(vencimiento) AS venc, min(titulo) AS titulo
  FROM next_actions WHERE estado = 'pendiente'::next_action_status AND owner_id IS NOT NULL GROUP BY owner_id
), gp AS (
  SELECT edificio_id, count(*)::int AS n, min(titulo) AS titulo, min(detalle) AS detalle
  FROM guard_proposals WHERE estado = 'pendiente' AND edificio_id IS NOT NULL GROUP BY edificio_id
), pleno AS (
  SELECT building_id, sum(pct_pleno) AS suma_pleno, count(*)::int AS n_pleno
  FROM v_rights_cuota_eligible GROUP BY building_id
), rg AS (
  SELECT s.building_id, s.apto_para_cuota, s.bloqueos,
    COALESCE(p.suma_pleno, 0::numeric) AS suma_pleno, COALESCE(p.n_pleno, 0) AS n_pleno,
    (s.apto_para_cuota AND COALESCE(p.n_pleno, 0) > 0
      AND COALESCE(p.suma_pleno, 0::numeric) >= 99 AND COALESCE(p.suma_pleno, 0::numeric) <= 101) AS rights_ok
  FROM v_building_rights_status s
  LEFT JOIN pleno p ON p.building_id = s.building_id
), cob AS (
  SELECT bo.building_id,
    count(*) FILTER (WHERE o.telefono IS NOT NULL AND o.telefono <> '')::int AS n_con_tel,
    count(*) FILTER (WHERE c2.n_calls > 0)::int AS n_contactados,
    max(c2.last_fecha) AS last_activity
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  LEFT JOIN cl c2 ON c2.owner_id = bo.owner_id
  GROUP BY bo.building_id
), enr AS (
  SELECT b.building_id, b.owner_id, b.nombre, b.telefono, b.email, b.rol, b.buyer_persona,
    b.fecha_nacimiento, b.edad_anios, b.estado_vital, b.consentimiento, b.cuota, b.rol_notas,
    b.direccion, b.comercial, b.score,
    COALESCE(cl.n_calls, 0) AS n_calls, cl.last_fecha,
    lo.last_outcome, lo.last_outcome_fecha,
    cons.veredicto, cons.cita_textual, cons.senal_fecha,
    wa.last_wa, na.venc AS na_venc, na.titulo AS na_titulo,
    gp.n AS n_guardas, gp.titulo AS guarda_titulo, gp.detalle AS guarda_detalle,
    COALESCE(rg.rights_ok, false) AS rights_ok,
    rg.suma_pleno, rg.n_pleno, rg.bloqueos AS bloqueos_derechos,
    cob.n_con_tel, cob.n_contactados, cob.last_activity,
    (length(regexp_replace(COALESCE(b.telefono, ''), '\D', '', 'g')) >= 9) AS tel_valido,
    GREATEST(0, (EXTRACT(epoch FROM (now() - COALESCE(lo.last_outcome_fecha, cl.last_fecha))) / 86400::numeric)::int) AS dias_ultima,
    array_remove(ARRAY[
      CASE WHEN b.rol IS NULL OR b.rol = 'desconocido' THEN 'rol/tipología' END,
      CASE WHEN b.cuota IS NULL THEN 'cuota de propiedad' END,
      CASE WHEN b.email IS NULL OR b.email = '' THEN 'email' END,
      CASE WHEN b.buyer_persona IS NULL OR b.buyer_persona = 'sin_clasificar' THEN 'buyer persona' END,
      CASE WHEN b.fecha_nacimiento IS NULL AND b.edad_anios IS NULL THEN 'edad / fecha de nacimiento' END
    ], NULL) AS huecos
  FROM base b
  LEFT JOIN cl ON cl.owner_id = b.owner_id
  LEFT JOIN lo ON lo.owner_id = b.owner_id
  LEFT JOIN cons ON cons.owner_id = b.owner_id
  LEFT JOIN wa ON wa.owner_id = b.owner_id
  LEFT JOIN na ON na.owner_id = b.owner_id
  LEFT JOIN gp ON gp.edificio_id = b.building_id
  LEFT JOIN rg ON rg.building_id = b.building_id
  LEFT JOIN cob ON cob.building_id = b.building_id
)
SELECT e.building_id, e.owner_id, e.nombre, e.direccion, e.comercial, e.score,
  e.telefono, e.tel_valido, e.n_calls, e.last_fecha, e.last_outcome, e.last_outcome_fecha,
  e.dias_ultima, e.huecos, e.estado_vital,
  e.rights_ok, e.suma_pleno, e.n_pleno, e.bloqueos_derechos,
  t.task_code, t.motivo, t.evidencia, t.objetivo,
  round(t.peso * GREATEST(e.score, 5::numeric), 2) AS prioridad
FROM enr e
CROSS JOIN LATERAL (
  SELECT v.task_code, v.peso, v.motivo, v.evidencia, v.objetivo, v.aplica
  FROM (VALUES
    ('T-01', 60::numeric,
      'Propietario asociado al edificio sin teléfono válido en el CRM.',
      jsonb_build_object('telefono', e.telefono, 'llamadas', e.n_calls),
      'Localizar y verificar un teléfono válido y el contexto del propietario. No llamar todavía.',
      (NOT e.tel_valido) AND e.rights_ok),
    ('T-02', 90::numeric,
      'Teléfono válido y cero llamadas registradas.',
      jsonb_build_object('telefono', e.telefono, 'llamadas', 0),
      'Primera llamada de contacto y cualificación inicial.',
      e.tel_valido AND e.n_calls = 0 AND e.estado_vital = 'activo' AND e.rights_ok),
    ('T-03', 70::numeric,
      'Consentimiento de WhatsApp detectado y sin envío posterior a la señal.',
      jsonb_build_object('veredicto', e.veredicto, 'cita', e.cita_textual, 'senal_fecha', e.senal_fecha, 'ultimo_whatsapp', e.last_wa),
      'Enviar el contenido acordado por WhatsApp y dejar registro.',
      (e.veredicto = 'autorizado' OR e.consentimiento IS TRUE) AND e.senal_fecha IS NOT NULL
        AND (e.last_wa IS NULL OR e.last_wa < e.senal_fecha) AND e.estado_vital = 'activo' AND e.rights_ok),
    ('T-04', 65::numeric,
      'Cadencia vencida según la última señal del propietario.',
      jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima, 'accion_vencida', e.na_titulo, 'vencimiento', e.na_venc),
      'Retomar el contacto y fijar próxima acción con fecha.',
      e.estado_vital = 'activo' AND COALESCE(e.last_outcome, '') <> 'interesado' AND e.rights_ok
        AND ((e.na_venc IS NOT NULL AND e.na_venc < CURRENT_DATE)
             OR (e.last_outcome = 'no_contestado' AND e.dias_ultima >= 30)
             OR (e.last_outcome = ANY (ARRAY['dudoso','otro','no_interesado']) AND e.dias_ultima >= 45))),
    ('T-05', 40::numeric,
      'Propietario ya contactado con huecos en la ficha (Nivel A/B).',
      jsonb_build_object('faltan', to_jsonb(e.huecos), 'llamadas', e.n_calls, 'ultima_llamada', e.last_fecha),
      'Completar los campos que faltan en la ficha del propietario.',
      e.n_calls > 0 AND array_length(e.huecos, 1) >= 2 AND e.rights_ok),
    ('T-06', 55::numeric,
      'Datos del edificio pendientes de verificación (guardas o derechos registrales sin capa verificada).',
      jsonb_build_object('guardas_pendientes', e.n_guardas, 'guarda', e.guarda_titulo, 'detalle', e.guarda_detalle,
                         'derechos_verificados', e.n_pleno, 'suma_pleno_verificado', e.suma_pleno,
                         'bloqueos_derechos', to_jsonb(e.bloqueos_derechos)),
      'Verificar y corregir los derechos registrales del edificio antes de operar sobre él.',
      COALESCE(e.n_guardas, 0) > 0 OR NOT e.rights_ok),
    ('T-08', 100::numeric,
      'La última llamada del propietario terminó como interesado.',
      jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima),
      'Confirmar cita y dejar próxima acción con fecha.',
      e.last_outcome = 'interesado' AND e.estado_vital = 'activo' AND e.rights_ok),
    ('T-09', 30::numeric,
      'Edificio con cobertura completa de titulares y sin novedad reciente.',
      jsonb_build_object('titulares_con_telefono', e.n_con_tel, 'contactados', e.n_contactados, 'ultima_actividad', e.last_activity),
      'Revisar si procede aparcar o reactivar el edificio. No es un cierre automático.',
      COALESCE(e.n_con_tel, 0) > 0 AND e.n_contactados >= e.n_con_tel
        AND e.last_activity IS NOT NULL AND e.last_activity < (now() - '90 days'::interval) AND e.rights_ok)
  ) v(task_code, peso, motivo, evidencia, objetivo, aplica)
  WHERE v.aplica
) t;

GRANT SELECT ON public.v_v5_task_candidates TO authenticated;
GRANT SELECT ON public.v_v5_task_candidates TO service_role;
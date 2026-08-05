
CREATE OR REPLACE VIEW public.v_v5_task_candidates AS
WITH base AS (
  SELECT bo.building_id, bo.owner_id, o.nombre, o.telefono, o.email,
         o.rol::text AS rol, o.buyer_persona::text AS buyer_persona,
         o.fecha_nacimiento, o.edad_anios, COALESCE(o.estado_vital,'activo') AS estado_vital,
         o.consentimiento, bo.cuota, bo.rol_notas,
         b.direccion, b.comercial, COALESCE(b.score_total, b.score, 0)::numeric AS score
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN public.buildings b ON b.id = bo.building_id
),
cl AS (SELECT owner_id, count(*)::int AS n_calls, max(fecha) AS last_fecha FROM public.calls GROUP BY 1),
lo AS (
  SELECT DISTINCT ON (owner_id) owner_id, outcome AS last_outcome, fecha AS last_outcome_fecha
  FROM public.calls WHERE outcome IS NOT NULL ORDER BY owner_id, fecha DESC
),
cons AS (
  SELECT DISTINCT ON (owner_id) owner_id, veredicto, cita_textual,
         COALESCE(fecha_llamada, detectado_at) AS senal_fecha
  FROM public.wa_consent_signals
  ORDER BY owner_id, COALESCE(fecha_llamada, detectado_at) DESC
),
wa AS (SELECT owner_id, max(COALESCE(enviado_at, created_at)) AS last_wa FROM public.whatsapp_messages GROUP BY 1),
na AS (
  SELECT owner_id, min(vencimiento) AS venc, min(titulo) AS titulo
  FROM public.next_actions WHERE estado = 'pendiente' AND owner_id IS NOT NULL GROUP BY 1
),
gp AS (
  SELECT edificio_id, count(*)::int AS n, min(titulo) AS titulo, min(detalle) AS detalle
  FROM public.guard_proposals WHERE estado = 'pendiente' AND edificio_id IS NOT NULL GROUP BY 1
),
sumc AS (
  SELECT building_id, sum(cuota) AS suma_cuota, count(*) FILTER (WHERE cuota IS NOT NULL)::int AS n_con_cuota
  FROM public.building_owners GROUP BY 1
),
cob AS (
  SELECT bo.building_id,
         count(*) FILTER (WHERE o.telefono IS NOT NULL AND o.telefono <> '')::int AS n_con_tel,
         count(*) FILTER (WHERE c2.n_calls > 0)::int AS n_contactados,
         max(c2.last_fecha) AS last_activity
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  LEFT JOIN cl c2 ON c2.owner_id = bo.owner_id
  GROUP BY 1
),
enr AS (
  SELECT b.*, COALESCE(cl.n_calls,0) AS n_calls, cl.last_fecha,
         lo.last_outcome, lo.last_outcome_fecha,
         cons.veredicto, cons.cita_textual, cons.senal_fecha,
         wa.last_wa, na.venc AS na_venc, na.titulo AS na_titulo,
         gp.n AS n_guardas, gp.titulo AS guarda_titulo, gp.detalle AS guarda_detalle,
         sumc.suma_cuota, sumc.n_con_cuota,
         cob.n_con_tel, cob.n_contactados, cob.last_activity,
         (length(regexp_replace(COALESCE(b.telefono,''), '\D', '', 'g')) >= 9) AS tel_valido,
         GREATEST(0, (EXTRACT(epoch FROM now() - COALESCE(lo.last_outcome_fecha, cl.last_fecha)) / 86400)::int) AS dias_ultima,
         ARRAY_REMOVE(ARRAY[
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
  LEFT JOIN sumc ON sumc.building_id = b.building_id
  LEFT JOIN cob ON cob.building_id = b.building_id
)
SELECT e.building_id, e.owner_id, e.nombre, e.direccion, e.comercial, e.score,
       e.telefono, e.tel_valido, e.n_calls, e.last_fecha, e.last_outcome, e.last_outcome_fecha,
       e.dias_ultima, e.huecos, e.estado_vital,
       t.task_code, t.motivo, t.evidencia, t.objetivo,
       round(t.peso * GREATEST(e.score, 5)::numeric, 2) AS prioridad
FROM enr e
CROSS JOIN LATERAL (
  SELECT * FROM (
    VALUES
      ('T-01', 60::numeric,
        'Propietario asociado al edificio sin teléfono válido en el CRM.',
        jsonb_build_object('telefono', e.telefono, 'llamadas', e.n_calls),
        'Localizar y verificar un teléfono válido y el contexto del propietario. No llamar todavía.',
        (NOT e.tel_valido)),
      ('T-02', 90::numeric,
        'Teléfono válido y cero llamadas registradas.',
        jsonb_build_object('telefono', e.telefono, 'llamadas', 0),
        'Primera llamada de contacto y cualificación inicial.',
        (e.tel_valido AND e.n_calls = 0 AND e.estado_vital = 'activo')),
      ('T-03', 70::numeric,
        'Consentimiento de WhatsApp detectado y sin envío posterior a la señal.',
        jsonb_build_object('veredicto', e.veredicto, 'cita', e.cita_textual, 'senal_fecha', e.senal_fecha, 'ultimo_whatsapp', e.last_wa),
        'Enviar el contenido acordado por WhatsApp y dejar registro.',
        ((e.veredicto = 'autorizado' OR e.consentimiento IS TRUE)
          AND e.senal_fecha IS NOT NULL
          AND (e.last_wa IS NULL OR e.last_wa < e.senal_fecha)
          AND e.estado_vital = 'activo')),
      ('T-04', 65::numeric,
        'Cadencia vencida según la última señal del propietario.',
        jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima, 'accion_vencida', e.na_titulo, 'vencimiento', e.na_venc),
        'Retomar el contacto y fijar próxima acción con fecha.',
        (e.estado_vital = 'activo' AND COALESCE(e.last_outcome,'') <> 'interesado' AND (
            (e.na_venc IS NOT NULL AND e.na_venc < current_date)
         OR (e.last_outcome = 'no_contestado' AND e.dias_ultima >= 30)
         OR (e.last_outcome IN ('dudoso','otro','no_interesado') AND e.dias_ultima >= 45)
        ))),
      ('T-05', 40::numeric,
        'Propietario ya contactado con huecos en la ficha (Nivel A/B).',
        jsonb_build_object('faltan', to_jsonb(e.huecos), 'llamadas', e.n_calls, 'ultima_llamada', e.last_fecha),
        'Completar los campos que faltan en la ficha del propietario.',
        (e.n_calls > 0 AND array_length(e.huecos,1) >= 2)),
      ('T-06', 55::numeric,
        'Datos del edificio pendientes de verificación (guardas o cuotas incoherentes).',
        jsonb_build_object('guardas_pendientes', e.n_guardas, 'guarda', e.guarda_titulo, 'detalle', e.guarda_detalle, 'suma_cuotas', e.suma_cuota, 'relaciones_con_cuota', e.n_con_cuota),
        'Verificar y corregir el dato marcado antes de operar sobre el edificio.',
        (COALESCE(e.n_guardas,0) > 0 OR (COALESCE(e.n_con_cuota,0) > 0 AND (e.suma_cuota < 99 OR e.suma_cuota > 101)))),
      ('T-08', 100::numeric,
        'La última llamada del propietario terminó como interesado.',
        jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima),
        'Confirmar cita y dejar próxima acción con fecha.',
        (e.last_outcome = 'interesado' AND e.estado_vital = 'activo')),
      ('T-09', 30::numeric,
        'Edificio con cobertura completa de titulares y sin novedad reciente.',
        jsonb_build_object('titulares_con_telefono', e.n_con_tel, 'contactados', e.n_contactados, 'ultima_actividad', e.last_activity),
        'Revisar si procede aparcar o reactivar el edificio. No es un cierre automático.',
        (COALESCE(e.n_con_tel,0) > 0 AND e.n_contactados >= e.n_con_tel
          AND e.last_activity IS NOT NULL
          AND e.last_activity < now() - interval '90 days'))
  ) AS v(task_code, peso, motivo, evidencia, objetivo, aplica)
  WHERE v.aplica
) AS t;

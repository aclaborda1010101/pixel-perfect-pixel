# Plan — lote reunión (9 puntos)

Lote grande y heterogéneo. Propongo ejecutarlo en 3 tandas para poder validar entre medias, en lugar de un único commit gigante que sea difícil de revisar.

## Tanda A — arreglos rápidos y de alto impacto (hoy)

**1. Ratio M²/viv en UI** — reemplazar todos los cálculos ad-hoc `m2_total/viviendas` por `ratio_m2_viv` de `v_building_score`. Grep en `src/` de `m2_total`, `/ viviendas`, `M²/VIV`, `m2_por_vivienda`. Cambiar cards de `Edificios.tsx` y bloques de `EdificioDetalle.tsx` + `ScoringResumen.tsx`. Fallback a `m2_total/viviendas` sólo si `ratio_m2_viv` es null.

**4. VOSS en castellano natural** — editar los system prompts de `agent_voss_coach` (SYSTEM_PRE y SYSTEM_POST) y `wa_ai_reply` con:
- Prohibiciones: "¿Parecería una locura si…?", "¿Sería terrible si…?", "Parece que usted…", dos preguntas por mensaje, etiquetar emociones, gratitud melosa.
- Reemplazos naturales: "¿Le encaja si…?" / "¿Le viene mal que…?" / "Por lo que me cuenta…" / "Corríjame si me equivoco, pero…" / "¿Ha descartado del todo…?".
- Mantener la lógica Voss (orientación al no, espejos, calibradas).

**5. Reintentos post-llamada 3/5/10 min** — sustituir el timer actual (15m) en el flujo del paso 2 (`PrepararLlamada.tsx` + `finalize_call_session`) por una cola de 3 intentos a T+3, T+5, T+10 min. Implementación: fila de la sesión con `next_retry_at` + `retries_left` y un cron cada minuto que dispare `finalize_call_session` cuando toque; o setTimeouts encadenados en cliente si la sesión sigue abierta. Preferido: cron server-side para que funcione aunque el comercial cierre la app.

**9d. Bot: una sola pregunta por mensaje** — reforzar en el prompt de `wa_ai_reply` la regla dura "exactamente UNA pregunta por mensaje, prohibido dos interrogantes seguidos"; añadir post-check regex que corte todo lo que venga tras la segunda `?`.

## Tanda B — mecánica de datos (siguiente turno)

**2. KPIs acumulativos** — el estado de KPIs es del propietario, no de la llamada. Cambios:
- Nueva vista/función `owner_kpis_state(owner_id)` que devuelve, para cada KPI (whatsapp/pixel/reunion/tipologia/motor/info_edificio/canal_abierto), la primera fecha en que se marcó `done=true` a lo largo de todas las `call_sessions` del propietario.
- `agent_voss_coach` mode=post recibe ese estado y, si un KPI ya estaba conseguido antes de la llamada actual, lo marca `previamente_conseguido: {fecha, hubspot_call_id}` en el checklist y NO penaliza el `score_0_100`.
- `KpiChecklistCard.tsx` renderiza chip verde "ya conseguido — 16/07" en vez de rojo "no conseguido".

**3. Bloque "Info del edificio"** — datos agregados de las llamadas de TODOS los propietarios del edificio:
- Nueva vista `v_building_common_intel(building_id)` que extrae de las auditorías VOSS (`call_sessions.voss_post`) y summaries: precio/oferta discutida, quién bloquea, gestor/portavoz, estado de venta, conflicto entre hermanos.
- Detección de discrepancias: si dos llamadas mencionan precios distintos con delta > 500k€ o > 10%, marcarlas como "verificar".
- Consumido por `agent_pre_call_brief` y `VossCoachCard` — sección "Info compartida del edificio" separada de "Info personal" (esta última sí se filtra por owner).

**8. Sección Oportunidades** — página nueva `/oportunidades` con entrada en sidebar (fuera del panel WhatsApp):
- Fuente: `wa_conversations` con flag `is_lead=true` o heurística (última mención de compra/venta/dirección/zona).
- Columnas: nombre/tel, resumen (3 líneas), zona detectada, comercial asignado.
- Pestañas Sin asignar · Jesús · David (mismo patrón que `Edificios.tsx`).
- Auto-asignación por zona configurable en `app_settings` (default: David = Vallecas/Carabanchel/Chamberí, Jesús = Salamanca/Centro).

## Tanda C — bot y notificaciones (siguiente turno)

**6. Emails al comercial** — usar `_shared/mailer.ts`. Mapa de destinatarios (definitivo, ANULA la instrucción anterior a agustin.cifuentes@outlook.es):
  - **Análisis de llamada listo** (fin de `finalize_call_session` con éxito) → SÓLO al comercial dueño de la llamada, mapeado por `hs_owner_id`:
      · 76826178 (Jesús) → jesus.anzola@afflux.es
      · 76826175 (David) → david.casero@afflux.es
      · desconocido/otro → jesus.anzola@afflux.es (fallback)
    Contenido: "Llamada analizada — X/100 — [link expediente]".
  - **Reunión agendada por el bot** (detección en `wa_ai_reply` o hook `wa_meeting_booked`) → jesus.anzola@afflux.es Y carlos.moreno@afflux.es (ambos en To/Cc), con fecha/hora, lead, teléfono y resumen de la conversación.
  - **Arranque de conversación + resumen a 15 min** del bot → SIGUEN yendo a carlos.moreno@afflux.es (`wa_conversation_email_dispatcher`, sin cambios).
  - PROHIBIDO cualquier mail a agustin.cifuentes@outlook.es (regla dura).
  - Mapa hs_owner_id→email centralizado en helper `_shared/comerciales.ts` para reutilizar.
  - **No** se crea la reunión en el calendario HubSpot — dejar `TODO` comentado.

**9a-c. Bot: agenda, pausa, palabra de cierre**:
- (a) Al detectar "reunión agendada" en `wa_ai_reply`: setear `wa_conversations.bot_paused_until = '2099-01-01'` y disparar mails (punto 6).
- (b) Trigger en `wa_messages` INSERT: si `direction='outbound'` y `source != 'bot'`, marcar `bot_paused=true` en la conversación.
- (c) Config `wa_bot_config.stop_words` (array); si el último outbound humano contiene una stop word, pausar bot para ese chat.

## Punto 7 — investigación en paralelo

Un subagente está comprobando si HubSpot expone la transcripción literal por API (propiedad, endpoint calling v1 o asociación v4). Según el resultado:
- Si SÍ hay endpoint → modificar `transcribe_calls` para bajarla de HubSpot y usar STT sólo como fallback (ahorro directo en costes).
- Si NO → mantener STT actual y reportar el hallazgo.

## Verificación del brief (ganchos por frescura)

Al final de la tanda A confirmo que la apertura del brief ordena por `fecha DESC` los ganchos (vacaciones → madre → edificio para Inés), releyendo la sección relevante de `agent_pre_call_brief` / `agent_voss_coach` mode=pre.

## Detalles técnicos

- Archivos previsiblemente tocados en tanda A: `src/pages/comercial/Edificios.tsx`, `src/pages/comercial/EdificioDetalle.tsx`, `src/components/comercial/ScoringResumen.tsx`, `supabase/functions/agent_voss_coach/index.ts`, `supabase/functions/wa_ai_reply/index.ts`, `supabase/functions/finalize_call_session/index.ts`, migración SQL para `call_sessions.next_retry_at`/`retries_left` + cron `finalize_pending_sessions_1m`.
- Todas las llamadas AI mantienen Luna primario / Gemini fallback vía OpenRouter.
- El punto 7 puede posponer la migración de `transcribe_calls`; si el subagente reporta que hay endpoint, entra en tanda A.

## Pregunta antes de arrancar

¿Ejecuto directamente la tanda A al terminar la investigación del punto 7, o quieres reordenar prioridades (p.ej. punto 8 Oportunidades primero, o punto 3 Info del edificio antes que 2)?
# Revisión del PDF "Sistema de IA Comercial Afflux" vs. lo construido

## TL;DR

El **copiloto IA (antes / durante / después)** ya está construido para el canal llamada (briefing Voss, checklist, análisis post, coach report). Los **KPIs básicos** (volumen, calidad, seguimientos) viven en la vista `v_kpis_comercial_semana` y se pintan en `/admin/RankingComercial`. **El bot WhatsApp** ya escribe propiedades en HubSpot y produce flags de oportunidad.

Lo que el documento pide y **no está**:

1. Fórmula de compensación ponderada (Fijo + €×Puntos + Bonus).
2. Scoring de calidad de reunión.
3. Flag de oportunidad por edificio para el canal llamada (no solo WA).
4. Escritura de KPIs post-llamada en propiedades **custom** del contacto HubSpot.
5. Panel mensual personal para cada comercial (hoy solo lo ve el admin).
6. Rol y soporte para closers externos.

Además hay **3 bugs latentes**: `calls.metadatos.reunion_cerrada`, `whatsapp_enviado` y `pixel_enviado` se leen en la vista de KPIs pero **nadie los escribe** → el panel actual muestra esos KPIs siempre en 0.

---

## Auditoría compacta (✅ existe · 🟡 parcial · ❌ no existe)

### Herramienta 1 — KPI Tracker → HubSpot
| | Estado | Dónde |
|---|---|---|
| Vista de KPIs semanal por comercial | ✅ | `supabase/migrations/…_v_kpis_comercial_semana.sql:54-71` |
| Panel ranking | ✅ | `src/pages/admin/RankingComercial.tsx` |
| Sync calls/communications HubSpot | ✅ | `hubspot_sync_communications`, `hubspot_live_engagements_reconcile` |
| Propiedades HubSpot del contacto post-llamada (tipología, motor, score, checklist) | ❌ | Solo `wa_sync_hubspot` lo hace, y solo para WA |
| Fórmula puntos KPI → € | ❌ | — |

### Herramienta 2 — Copiloto IA
| | Estado | Dónde |
|---|---|---|
| Briefing pre-llamada | ✅ | `agent_pre_call_brief`, `agent_voss_coach` mode=`brief`, `PrepareCallWizard`, `PrepararLlamada` paso 1 |
| Guion + checklist durante | 🟡 | Checklist en paso 2 de `PrepararLlamada.tsx:394-454`. El guion Voss se carga en paso 1, no hay overlay accesible mientras se llama |
| Transcripción | ✅ | `transcribe_call` |
| Análisis post (tecnica_score, outcome, tácticas) | ✅ | `analyze_call/index.ts:26-136` |
| Feedback Voss post + checklist + score | ✅ | `agent_voss_coach` mode=`post`, persistido en `finalize_call_session/index.ts:125-191` |
| Coach report semanal | ✅ | `generate_coach_report` |
| Push de KPIs a HubSpot tras llamada | ❌ | `finalize_call_session` solo escribe en Supabase |

### KPIs Procesos 1–2
| KPI | Estado | Comentario |
|---|---|---|
| Nº llamadas | ✅ | `llamadas_total` |
| Calidad llamada (IA) | ✅ | `calls.tecnica_score` → `calidad_media` |
| Tipología proindivisario | 🟡 | Se captura en `call_sessions.checklist.tipologia_capturada` pero no se escribe en `owners.buyer_persona` desde el copiloto (solo el bot WA lo hace) |
| Info extraída | 🟡 | Queda en JSON de sesión, no en campos estructurados de `owners` ni HubSpot |
| Motivación / qué le mueve | 🟡 | Flag booleano en checklist, sin texto estructurado equivalente al `motivacion_principal` del bot WA |
| Pixel / WhatsApp enviado | 🟡 | Vista lo cuenta pero **nadie escribe el flag** → siempre 0 |
| Seguimiento a X días | 🟡 | `next_actions` se crea (`PrepararLlamada.tsx:283-294`). Falta KPI "% cumplidos en plazo" |
| % cobertura del edificio | 🟡 | Se calcula al vuelo en `Dashboard.tsx:108-116`, no se persiste por comercial/periodo |

### KPIs Procesos 3–4
| KPI | Estado | Comentario |
|---|---|---|
| Nº reuniones organizadas | 🟡 | Lee `calls.metadatos.reunion_cerrada` (no escrito). `hubspot_meetings` está sincronizado pero no se usa para el KPI |
| Calidad de la reunión | ❌ | No hay scoring IA de reunión |
| Flag OPORTUNIDAD por edificio (4 criterios del doc) | 🟡 | Solo vía WA (`wa_ai_reply` produce `oportunidad_flags`). No hay flag unificado por edificio que combine: calidad edificio + situación propietarios + demanda inversor + precio |

### Compensación, panel y externos
- ❌ Fórmula `Fijo + €×Puntos + Bonus` (pesos 25/15/15/15/15/10/5).
- 🟡 Panel mensual: `RankingComercial` (semanal, admin). No hay vista personal mensual para el comercial.
- ❌ Rol `closer_externo` con baremo y acceso restringido.

---

## Plan para cerrar gaps

Lo divido en 6 bloques independientes para que decidas qué entra al sprint y qué no. No toco bot WA, escaleras, scoring P0 ni el copiloto IA actual salvo donde se indica.

### Bloque A · Fix de los 3 KPIs fantasma (prioridad alta, esfuerzo mínimo)
Sin esto la vista de ranking miente.

- `PrepararLlamada.tsx` cuando el comercial marque objetivo "Enviar WhatsApp" o "Enviar pixel" → al finalizar sesión, escribir `calls.metadatos.whatsapp_enviado=true` / `pixel_enviado=true` en `finalize_call_session`.
- Cuando el outcome de la llamada sea "reunion_agendada" o se cree un `next_action` tipo `reunion` → `calls.metadatos.reunion_cerrada=true`.
- Verificar con `RankingComercial` que aparecen valores >0.

### Bloque B · Escritura de KPIs post-llamada en HubSpot
Nueva edge function `hubspot_sync_call_kpis` análoga a `wa_sync_hubspot`, invocada al final de `finalize_call_session`:

- Resuelve `hubspot_contact_id` del owner llamado (ya existe el camino en `external_ids`).
- Crea/actualiza una **nota engagement** con el resumen del análisis + checklist + Voss post.
- Actualiza propiedades custom del contacto: `afflux_tipologia`, `afflux_motivacion`, `afflux_tecnica_score`, `afflux_ultima_llamada_at`, `afflux_canal_abierto`, `afflux_info_edificio_capturada`. Primero leer propiedades con `crm/v3/properties/contacts` y reportar las que falten (no las creo sin tu OK).
- Actualiza `hs_lead_status` igual que hace WA.

### Bloque C · Fórmula de compensación y puntos KPI
- Nueva tabla `kpi_compensation_config` (1 fila editable): `eur_por_punto`, `fijo_mensual`, `bonus_oportunidad`, y JSON de pesos por KPI (defaults del doc).
- Nueva vista `v_puntos_kpi_comercial_mes` que normaliza cada KPI a 0–100 y aplica pesos → `puntos_total` y `eur_mes` por comercial.
- Panel admin en `src/pages/admin/IA.tsx` o nuevo `src/pages/admin/Compensacion.tsx` para editar config y previsualizar nómina del mes en curso.
- **Importante**: lo dejo en "modo simulación" hasta que tú valides; no se envía a ningún sitio.

### Bloque D · Panel mensual personal del comercial
- Nueva ruta `src/pages/comercial/MiRendimiento.tsx` que para `auth.uid()` muestra: KPIs del mes, puntos acumulados, € estimados, posición vs. equipo, ranking semanal (la misma vista pero filtrada al usuario), y el último `coach_report`.
- Enlace desde el sidebar comercial.

### Bloque E · Calidad de reunión y flag oportunidad por edificio (canal llamada)
- **Calidad reunión**: cuando `hubspot_meetings` recibe una reunión cerrada vinculada a un building, una función `score_meeting` (LLM sobre nota + transcripción si existe + ficha edificio) produce `calidad_reunion` 0–100. Persistir en `hubspot_meetings.metadatos`.
- **Flag oportunidad por edificio**: nueva función `compute_building_opportunity` que combina:
  1. score interno del edificio (>X),
  2. señales de propietarios (cuota_accionable, decisor único, urgencia alta) tanto de WA como de `call_sessions`,
  3. flag manual de "demanda inversor" (campo en `buildings`),
  4. precio potencial (de Catastro/valoración existente).
  Salida: `buildings.flag_oportunidad` enum {ninguna, posible, validada}. Mostrar badge en `Edificios` y `EdificioDetalle`.

### Bloque F · Closers externos (opcional, último)
- Nuevo `app_role='closer_externo'` y políticas RLS que limiten a `building_assignments` propios.
- Mismo baremo de Bloque C, pero con tarifa diferenciada (`eur_por_punto_externo`).
- Acceso a `MiRendimiento`, `PrepararLlamada` y `Tareas`; nada de admin, valoraciones ni RankingComercial global.

---

## Detalles técnicos

- Migraciones SQL: nuevas tablas `kpi_compensation_config`, vistas `v_puntos_kpi_comercial_mes`, columnas en `buildings` (`flag_oportunidad`, `demanda_inversor`). Todas con GRANT a `authenticated` y RLS.
- Edge functions nuevas: `hubspot_sync_call_kpis`, `score_meeting`, `compute_building_opportunity`.
- Edge functions tocadas: `finalize_call_session` (writes de metadatos KPI + invoca `hubspot_sync_call_kpis`).
- Frontend nuevo: `MiRendimiento.tsx`, opcional `Compensacion.tsx`.
- No se tocan: bot WA, escaleras, scoring P0 de edificios, voss_coach, analyze_call, transcribe_call.

## Fuera de alcance de este plan

- Cambiar el algoritmo Voss o el guion del copiloto.
- Migrar el panel actual de admin a otra estructura.
- Conectar el HubSpot mapping de WA al nuevo HubSpot mapping de llamadas (siguen separados, mismo destino, distintos disparadores).

## Pregunta antes de implementar

¿Te interesa el **Bloque A + B** ya (los considero crítico-bug + base para todo lo demás) y dejamos C–F para una segunda iteración con cifras tuyas, o vamos al paquete completo de una vez? También necesito tu OK para crear las propiedades custom en HubSpot (las nombro `afflux_*`).

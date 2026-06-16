
# WhatsApp Bot – integración Evolution API + rol dedicado

## 1. Usuario y rol

- **Crear usuario** `whatsapp@aflux.es` / `1234` desde el panel de Admin → Equipo (lo creo yo vía backend en una migración + insert: `auth.users` no se toca directo, así que usaré un edge function `admin_create_user` puntual con service_role para crearlo y asignar rol).
- **Nuevo rol** `whatsapp` en el enum `app_role`.
- `ProtectedRoute`: usuarios con rol `whatsapp` solo pueden entrar a `/whatsapp/*` y a fichas de leads/owners en modo edición (sin acceso a `/admin`, `/comercial`, `/ajustes` avanzados).
- Login redirige a `/whatsapp` cuando el rol es `whatsapp`.

## 2. Secretos (Evolution API)

Pediré por el flujo de secretos:
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE_NAME` (nombre de instancia que vamos a usar; si no existe la crearemos vía API)

`LOVABLE_API_KEY` ya está disponible para la IA (Gemini).

## 3. Base de datos (migración)

Tablas nuevas en `public`:

- `wa_instances` — instancia Evolution vinculada (status, qr_base64, phone_number, last_seen_at).
- `wa_contacts` — lead/contacto WhatsApp (phone E.164, name, lead_id opcional → owners.id, stage: `nuevo|conversando|cualificado|caliente|frio|handoff|cerrado`, sentiment, last_message_at, tags jsonb).
- `wa_conversations` — hilo por contacto (status, summary, qualification jsonb {presupuesto, zona, tipologia, plazo, motivacion…}, ai_enabled boolean default true).
- `wa_messages` — mensajes (conversation_id, direction in/out, content, media_url, type, evolution_message_id, ai_generated, created_at).
- `wa_campaigns` — campañas de leads (nombre, plantilla, target_count, sent_count, replied_count).
- `wa_campaign_targets` — lead × campaña (status: pending/sent/replied/qualified/lost).
- `wa_bot_config` — persona, tono, objetivos, datos a extraer, mensajes prohibidos (single row).

Todas con RLS + GRANT a `authenticated` y `service_role`. Políticas:
- Rol `whatsapp` y `admin`: full CRUD.
- Resto: solo lectura de `wa_conversations`/`wa_messages` si el `wa_contacts.lead_id` corresponde a un owner de su cartera.

## 4. Edge functions

- `evolution_webhook` (verify_jwt=false): recibe eventos de Evolution (`messages.upsert`, `connection.update`, `qrcode.updated`). Persiste mensajes entrantes, actualiza QR/estado de instancia, y si `ai_enabled` → encola respuesta.
- `evolution_connect`: crea/recupera instancia, devuelve QR (base64) para escanear, registra webhook URL automáticamente.
- `evolution_disconnect` / `evolution_status`.
- `wa_send_message`: envía mensaje saliente vía Evolution (manual desde UI o desde el bot).
- `wa_ai_reply`: genera respuesta con Lovable AI (`google/gemini-3-flash-preview`), usando:
  - System prompt construido desde `wa_bot_config` + estilo "Chris Voss" + objetivo de cualificación.
  - Historial de los últimos N mensajes.
  - Tool calls: `update_qualification`, `set_stage`, `tag_contact`, `schedule_followup`. (Sin handoff humano: siempre auto, según tu elección).
  - Anti-detección bot: variabilidad en tiempos de respuesta (delay 4-30s aleatorio), emojis ocasionales, errores tipográficos sutiles opcionales, división en 1-3 mensajes cortos.
- `wa_campaign_send`: envía la plantilla de una campaña a la lista de targets, en lotes con rate-limit.
- `admin_create_user` (one-shot): crea `whatsapp@aflux.es` y le asigna rol `whatsapp`.

## 5. Frontend – Dashboard `/whatsapp`

Layout propio (sin sidebar del CRM cuando rol = whatsapp), con tabs:

- **Inbox** (default): lista de conversaciones a la izquierda (filtros: stage, sin leer, campaña), chat a la derecha con historial, badge "🤖 Auto" si `ai_enabled`, toggle para pausar bot por conversación, panel lateral con qualification extraída en vivo + datos del lead.
- **Leads/Pipeline**: kanban por `stage` (nuevo → conversando → cualificado → caliente → cerrado), drag&drop, click abre conversación.
- **Campañas**: lista de campañas, crear nueva (selección de leads del CRM, plantilla, programación), métricas (enviados, respondidos, % cualificación).
- **Conexión**: card con estado de instancia, botón "Conectar WhatsApp" → muestra QR (polling cada 3s), botón desconectar, número conectado, último ping.
- **Bot config**: editor del prompt/persona, datos a extraer, horario activo, mensaje fuera de horario.

Componentes nuevos en `src/pages/whatsapp/*` y `src/components/whatsapp/*`. Realtime vía Supabase channels sobre `wa_messages` para inbox en vivo.

## 6. Acceso desde Topbar/Login

- Tras login, si `role === 'whatsapp'` → `Navigate to="/whatsapp"`.
- Admin ve enlace "WhatsApp" en el menú Admin del Topbar.
- `AppSidebar` oculto para rol `whatsapp`; layout `/whatsapp` usa su propia shell minimal.

## 7. Detalle técnico

- Webhook URL a registrar en Evolution: `https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/evolution_webhook`.
- Cola simple: tabla `wa_ai_jobs` (pendiente/processing/done) procesada por `wa_ai_reply` invocada desde `evolution_webhook` con `setTimeout` (Deno) + delay anti-bot.
- Rate limit envíos: máx 1 msg / 8-20s por número saliente.
- Logs de IA persistidos en `wa_messages.metadatos` (model, tokens, tool calls).
- Errores Lovable AI: 402 → toast "créditos agotados", 429 → reintento con backoff.

## 8. Lo que NO se toca

- Resto del CRM, scoring, HubSpot sync, jobs existentes.
- Estructura actual de `/admin`, `/comercial`, `/ajustes`.

## Orden de ejecución

1. Migración (enum `whatsapp`, tablas wa_*, RLS, grants).
2. Pedir secretos Evolution.
3. Edge functions (`evolution_*`, `wa_*`, `admin_create_user`).
4. Crear usuario `whatsapp@aflux.es`.
5. Layout + rutas `/whatsapp/*` + redirect por rol.
6. UI Inbox → Conexión QR → Pipeline → Campañas → Bot config.
7. Conectar realtime y probar flujo end-to-end con un número de pruebas.

¿Procedo así?

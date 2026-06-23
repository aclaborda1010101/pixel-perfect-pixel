
# Memoria conversacional en el bot de WhatsApp

## Objetivo
Que el bot de WhatsApp, antes de responder, sepa:
1. Si ya se ha hablado antes con ese contacto (por teléfono / `wa_contact_id`).
2. **Quién** habló (bot automático, agente humano X, campaña Y) y **cuándo**.
3. **Qué** se dijo: últimos mensajes y un resumen de la relación (intereses, edificios mencionados, objeciones, estado del lead).

Hoy el bot responde "en frío" por cada mensaje entrante, sin recuperar el histórico ni saber que ese número ya fue contactado por un comercial o por otra campaña.

## Alcance

### 1. Recuperación de contexto al recibir un mensaje
En `evolution_webhook` (o el handler que invoca al LLM), antes de llamar al modelo:

- Buscar/crear `wa_contacts` por teléfono.
- Cargar de `wa_messages` los últimos N mensajes (configurable, por defecto 30) de esa conversación, en orden cronológico, con `from_me`, `sender_type` (bot / agente humano / contacto) y timestamp.
- Cargar de `wa_conversations` el estado actual (campaña activa, último agente humano que intervino, etiquetas).
- Cruzar con CRM:
  - `hubspot_communications` / `hubspot_whatsapp` / `calls` / `hubspot_notes` para ver si un comercial ya habló con ese número fuera de WhatsApp.
  - `building_assignments` / `owners` si el teléfono está vinculado a un propietario/edificio.
- Construir un bloque `system` con:
  - Resumen del contacto (nombre, edificio/propietario asociado si lo hay, estado del lead).
  - Quién ha hablado antes y cuándo (ej.: "Agente Marta llamó el 12/06, dejó nota: interesado pero pide tasación").
  - Últimos N mensajes del hilo de WhatsApp tal cual.

### 2. Resumen persistente por contacto
Para no inflar el prompt cuando hay cientos de mensajes:

- Nueva columna `wa_contacts.conversation_summary` (text) + `summary_updated_at` + `summary_message_count`.
- Job ligero (`wa_summarize_contact`) que, cada vez que se acumulan >20 mensajes nuevos desde el último resumen, regenera el resumen vía Lovable AI (`google/gemini-2.5-flash`).
- El prompt del bot recibe: `conversation_summary` + últimos 15 mensajes literales (en vez de toda la historia).

### 3. Identidad del interlocutor previo
En cada mensaje guardado en `wa_messages` asegurar que se rellena:
- `sender_type`: `contact` | `bot` | `human_agent`.
- `agent_user_id` (FK a `profiles`) cuando el mensaje saliente lo escribió un humano desde el panel.
- `campaign_id` cuando vino de un envío masivo.

El bot, al construir el contexto, mostrará en el system algo tipo:
```
Historial previo:
- 2026-06-10 (agente humano: Marta) → "Hola Juan, te llamo por tu edificio de Goya..."
- 2026-06-10 (contacto) → "No me interesa ahora mismo"
- 2026-06-18 (bot, campaña 'reactivacion_q2') → "..."
```

### 4. UI
En `WhatsappDashboard` / vista de conversación:
- Mostrar badge "Ya contactado por: Marta (call), Pedro (WhatsApp)" arriba del hilo.
- Mostrar el `conversation_summary` plegable.
- Que el operador humano vea exactamente el mismo contexto que recibe el bot (botón "Ver contexto enviado al bot").

## Cambios técnicos

- **Migración SQL**:
  - `wa_contacts`: añadir `conversation_summary text`, `summary_updated_at timestamptz`, `summary_message_count int default 0`, `last_human_agent_id uuid`, `last_human_contact_at timestamptz`.
  - `wa_messages`: añadir `sender_type text check in ('contact','bot','human_agent')`, `agent_user_id uuid references profiles(id)`, `campaign_id uuid` (si no existe ya).
  - Índice `wa_messages (wa_contact_id, created_at desc)`.
- **Edge function `evolution_webhook`** (o handler del bot): nueva función `buildBotContext(contactId)` que devuelve `{summary, recentMessages, crmTouchpoints, assignedAgent}` y se inyecta como system message antes del prompt actual.
- **Edge function nueva `wa_summarize_contact`**: input `contact_id`, regenera resumen y lo guarda. Llamada después de cada N mensajes nuevos o vía cron nocturno para contactos activos.
- **Frontend**: componente `ConversationContextPanel` en la vista de conversación + badge de "previamente contactado".

## Preguntas
1. ¿Cuántos mensajes literales quieres pasarle al bot por defecto (15 / 30 / 50)? Más mensajes = más coste por respuesta.
2. ¿Incluyo también llamadas (`calls` / `hubspot_calls`) y notas del CRM en el contexto del bot, o solo el historial de WhatsApp?
3. El resumen por contacto, ¿lo regeneramos automáticamente cada 20 mensajes nuevos, o prefieres un cron nocturno único para todos los contactos activos?

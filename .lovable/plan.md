## Problema

El contacto **CmC** (+34664885931) envió hoy 08:49 "He escaneado el QR de la revista y me gustaría entender mi situación actual" (mismo texto que su primer mensaje del 19/jun). El bot no contestó.

En `wa_ai_jobs` el job quedó en `status='skipped_dup'`. El motivo está en `supabase/functions/wa_ai_reply/index.ts` (líneas 282–296):

- El comentario dice "si el bot acaba de mandar literalmente lo mismo en los **últimos 5 minutos**".
- El código **no mira timestamps**: compara la respuesta nueva contra los **últimos 6 mensajes OUT de toda la historia**.
- Como el cliente repitió su mensaje inicial, el modelo regeneró un saludo parecido al del 19/jun (que sigue dentro de esos 6 últimos OUT) → se filtran todas las variantes → no se manda nada y nadie se entera.

## Cambios (solo `supabase/functions/wa_ai_reply/index.ts`)

1. **Anti-duplicado real por ventana temporal**
   - Construir `recentOuts` solo con OUT cuyo `created_at >= now() - 5 min` (cumpliendo el comentario actual).
   - Mantener la normalización (`trim` + lowercase + colapsar espacios).

2. **Comparación más tolerante y por mensaje, no por bloque**
   - Si una respuesta concreta coincide con un OUT reciente, descartar solo ese mensaje, no toda la tanda (ya lo hace, se conserva).
   - Si tras filtrar quedan 0 respuestas, en lugar de quedarse en silencio:
     - Marcar el job como `skipped_dup` (igual que ahora) **pero además**
     - Insertar una nota interna en la conversación (`wa_messages` direction='out' type='system' / metadata `{ kind: 'dup_skip', model_reply: parsed.messages }`) y subir `unread_count` para que el comercial lo vea en el Inbox.
     - Devolver `{ ok:true, skip:'duplicate', logged:true }`.

3. **Disparador de seguridad**
   - Si el último mensaje IN del cliente es idéntico (norm) a uno IN anterior con respuesta enviada, forzar al modelo a no repetir saludos: añadir al `systemPrompt` la instrucción "el cliente ha reenviado un mensaje previo; retoma la conversación donde la dejasteis, no saludes de nuevo".

4. **Trazabilidad**
   - Guardar en `wa_ai_jobs.error` (cuando `skipped_dup`) un breve `{reason, matched_idx}` para depurar futuras incidencias sin tener que leer logs de la función.

## Reproceso del caso CMC

Tras desplegar, invocar manualmente `wa_ai_reply` con `{ conversation_id: '623711f0-bcdc-4a92-a933-64320da3f495' }` para que conteste al mensaje pendiente de 08:49.

## Fuera de alcance

- No se tocan: `evolution_webhook`, `wa_send_message`, escaleras-visor-madrid, scoring, P0, ni la UI del Inbox/Historial (más allá de que el nuevo "system message" aparecerá automáticamente porque ya se renderiza la lista de `wa_messages`).
- No se cambian enums ni roles.

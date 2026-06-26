## Problema

El cliente envía `/reset` por WhatsApp y el bot no responde nada. El branch del comando ya existe en `evolution_webhook/index.ts` (líneas 67–139) pero no se dispara o falla en silencio.

## Causas probables

1. **El texto no llega como esperamos.** Hoy se lee de `m.conversation` o `m.extendedTextMessage?.text`. Algunos clientes mandan `/reset` con un espacio invisible, mayúsculas, o el cuerpo viene en otro campo (`buttonsResponseMessage`, `ephemeralMessage.message.conversation`, etc.) y `text` queda vacío → no entra al branch.
2. **El branch entra pero el `sendText` a Evolution falla** y solo se hace `console.warn`. Sin re-lanzar y sin log estructurado, no nos enteramos y el cliente no ve respuesta.
3. **No tenemos visibilidad**: no hay un solo `console.log("[reset] ...")` en el flujo, así que ahora mismo no podemos diferenciar (1) de (2) en los logs de la edge function.

## Plan

Tocar **solo** `supabase/functions/evolution_webhook/index.ts`. Nada más del CRM.

1. **Extracción de texto robusta**: antes del check, calcular `text` también desde:
   - `m.extendedTextMessage?.text`
   - `m.ephemeralMessage?.message?.conversation`
   - `m.ephemeralMessage?.message?.extendedTextMessage?.text`
   - `m.viewOnceMessageV2?.message?.conversation`
   - `m.buttonsResponseMessage?.selectedDisplayText`
   - `m.templateButtonReplyMessage?.selectedDisplayText`
   
   Y normalizar: `trim()`, quitar caracteres invisibles (`\u200b`, `\u200e`, `\u200f`, `\ufeff`), pasar a minúsculas.

2. **Matcher más permisivo**: aceptar `/reset`, `reset`, `/start`, `/reiniciar`, `reiniciar` como sinónimos (mismo efecto). Mantener exacto tras normalizar.

3. **Logging explícito**: añadir `console.log("[reset] detected", { phone, raw: text })` al entrar al branch y `console.log("[reset] ack sent", { msgId })` / `console.error("[reset] ack FAILED", err)` en el envío. Así, si vuelve a fallar, los logs de la función lo dicen en una línea.

4. **No tragarse el error del envío**: si `evoFetch` del ack falla, devolver `{ ok:false, reset:true, ack_error }` con 200 igualmente (Evolution no debe reintentar el webhook), pero el error queda en la respuesta y en los logs.

5. **Verificación**:
   - Desplegar.
   - Pedirte que mandes `/reset` desde el WhatsApp de prueba.
   - Leer `edge_function_logs` de `evolution_webhook` para confirmar `[reset] detected` y `[reset] ack sent`.
   - Confirmar en `wa_conversations` que la antigua quedó `closed` con `closed_reason=reset_by_user` y hay una nueva `open`.

## Lo que NO se toca

- `wa_ai_reply`, `wa_followups`, `wa_send_message`, dashboard de WhatsApp, scoring, escaleras, IEE, ni ninguna otra función.
- Esquema de BD: no hace falta migración.

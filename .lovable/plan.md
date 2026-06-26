## Comando `/reset` en WhatsApp

Cuando un cliente envíe el mensaje `/reset` (solo eso, sin más texto, mayúsc/minúsc indiferente), el sistema cierra la conversación actual y arranca una nueva limpia, sin histórico para el bot.

### Comportamiento
1. El webhook detecta `/reset` antes de procesar normalmente el mensaje.
2. Marca la conversación abierta actual como `status = 'closed'` (con motivo `reset_by_user` en metadatos) — **no se borran mensajes**, queda auditoría.
3. Crea una conversación nueva vacía para ese contacto.
4. Resetea en `wa_contacts` el `stage` a inicial y limpia `metadata` de cualificación reciente para que el bot no arrastre contexto.
5. Responde automáticamente con un mensaje corto tipo: "Conversación reiniciada. ¿En qué puedo ayudarte?" (vía la misma vía de envío que usa el bot).
6. No dispara `wa_ai_reply` para ese mensaje `/reset` — la nueva conversación queda lista para el siguiente mensaje real del cliente.

### Cambios técnicos
- `supabase/functions/evolution_webhook/index.ts`: añadir bloque que, tras detectar texto entrante, compruebe `text.trim().toLowerCase() === '/reset'`. Si coincide: cerrar conv. abierta, crear nueva, enviar confirmación con `sendWhatsappText` (ya existe en `_shared/evolution.ts`), y `return` sin encolar `wa_ai_jobs` ni llamar a `wa_ai_reply`.

### Fuera de alcance
- No se borran mensajes históricos (queda auditoría).
- No se toca el bot ni el resto de funciones.
- No se expone el comando en UI; es un comando oculto para pruebas/cliente.

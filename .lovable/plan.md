## Objetivo
Que el bot responda rápido cuando ya estás en plena conversación, pero mantenga el "delay humano" largo solo en el primer contacto.

## Cambio único: `supabase/functions/wa_ai_reply/index.ts`

En el bloque "TIEMPOS HUMANOS" (líneas ~289-299), calcular el delay en función de si la conversación está **activa** o **fría**:

- **Conversación activa** = existe un mensaje saliente del bot en los últimos 5 minutos (mirar `realHistory` o consultar `wa_messages`).
- **Conversación fría / primer contacto** = no hay saliente reciente.

Lógica:

```text
if (conversación activa) {
  minS = cfg.reply_delay_active_min ?? 3
  maxS = cfg.reply_delay_active_max ?? 10
} else {
  minS = cfg.reply_delay_min ?? 8         // se mantiene
  maxS = cfg.reply_delay_max ?? 45        // se mantiene
}
```

El typing por mensaje también se acorta proporcionalmente: `typingMs = clamp(perMsg - 400, 800, 6000)` cuando está activa, manteniendo el clamp actual (1500–12000) cuando está fría.

Las micro-pausas entre mensajes parten (700–2300 ms) → cuando está activa, 300–900 ms.

## Lo que NO cambia
- `reply_delay_min` / `reply_delay_max` de `wa_bot_config` siguen siendo el delay de "primer contacto".
- Sin migración: se usan defaults en código (`3` y `10` segundos) para la ventana activa; si más adelante quieres exponerlos en config los añadimos.
- Nada del resto del flujo (handoff manual, anti-duplicados, multimedia, resumen) se toca.

## Resultado esperado
- Primer mensaje del lead → el bot tarda 8–45 s como hasta ahora (suena natural y da margen al multimedia).
- Mientras el lead está respondiendo en vivo → el bot contesta en 3–10 s, sin minutos muertos.
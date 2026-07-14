## Diagnóstico

He revisado `supabase/functions/wa_ai_reply/index.ts` y hay dos bugs claros:

### Bug 1 · Re-saludo al reanudar
El historial SÍ se le pasa al modelo (últimos 60 mensajes, líneas 220-227) y el prompt tiene una regla "CONTEXTO INTERNO" que dice "no reinicies como si fuera la primera vez" (línea 332), pero:

- Esa regla solo aplica cuando el propietario ya está en el CRM (contexto de contacto previo del equipo), NO al hecho de que la propia conversación de WhatsApp ya tenga turnos anteriores.
- La sección OPENER (líneas 823-832) le dice literalmente al modelo: *"En tu PRIMER mensaje: saluda… preséntate como JAIME del equipo de Afflux… algo del tipo: 'Hola, buenos días. Soy Jaime, del equipo de Afflux. ¿Con quién tengo el gusto?'"*. Sin condición de "solo si no hay historial", el modelo lo dispara también al reanudar tras un gap de horas.

No es un problema de memoria/tokens (60 mensajes caben de sobra en Claude Sonnet 4.6 / GPT-5.6 Luna): es que el prompt no distingue entre **arranque en frío** y **reanudación**.

### Bug 2 · "Buenas noches" a las 9:55
El prompt inyecta la **fecha** (`hoyMadrid`, línea 597) pero NO la **hora**. En la sección OPENER dice "espeja su saludo, 'buenos días'/'buenas tardes'", pero el modelo elige el saludo a ciegas cuando el cliente no ha saludado explícitamente. Al reanudar automáticamente (vía `wa_replay_deferred`) a las 9:55 con un mensaje del cliente de anoche, el modelo interpreta el timestamp del último inbound del cliente ("ayer 22:xx") y contesta "buenas noches".

## Fix (un solo archivo: `supabase/functions/wa_ai_reply/index.ts`)

### 1. Inyectar hora local Madrid + saludo horario canónico
Justo al lado de `hoyMadrid` (línea 595), añadir:

```ts
const ahoraMadridHHMM = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date());
const horaMadrid = Number(ahoraMadridHHMM.slice(0, 2));
const saludoHorario =
  horaMadrid < 13 ? "buenos días"
  : horaMadrid < 21 ? "buenas tardes"
  : "buenas noches";
```

E inyectarlos en el bloque `CONTEXTO REAL` del `systemPrompt` (línea 634):

```
- HORA ACTUAL en Madrid: ${ahoraMadridHHMM}.
- SALUDO HORARIO CANÓNICO ahora: "${saludoHorario}". Si vas a saludar, usa ESTE
  saludo — no otro. NUNCA "buenas noches" antes de las 21:00. NUNCA "buenos días"
  después de las 13:00. El timestamp de los mensajes previos NO cuenta: manda la
  hora actual.
```

### 2. Detectar reanudación en código y condicionar el OPENER
Ya está calculado `realHistory` (línea 227). Justo después, calcular:

```ts
const hasBotReplied = realHistory.some((m: any) => m.direction === "out");
const lastOut = [...realHistory].reverse().find((m: any) => m.direction === "out");
const gapHoursSinceLastOut = lastOut
  ? (Date.now() - new Date(lastOut.created_at).getTime()) / 3600000
  : null;
```

Cambiar el bloque OPENER del prompt (líneas 821-838) para que sea **condicional**. En lugar de un texto plano fijo, construir dinámicamente:

```ts
const openerBlock = !hasBotReplied
  ? `<texto actual del OPENER, con "buenos días/tardes/noches" sustituido
     por el placeholder ${saludoHorario}>`
  : `OPENER — ESTO ES UNA CONTINUACIÓN, NO UN PRIMER CONTACTO.
     En el historial YA hay respuestas del equipo (mensajes "assistant").
     REGLAS DURAS de reanudación:
     - PROHIBIDO presentarte de nuevo ("Soy Jaime", "del equipo de Afflux",
       "¿con quién tengo el gusto?", "encantado de saludarle"). Ya lo hiciste.
     - PROHIBIDO pedirle el nombre otra vez. Si lo dio en algún mensaje previo,
       úsalo; si no, sigue sin nombre.
     - Retoma el hilo desde donde quedó (mira los últimos 3-4 turnos). Si han
       pasado horas o un día, puedes reconocerlo con naturalidad
       ("${saludoHorario}, retomamos entonces…" / "Hola de nuevo,
       ${saludoHorario}…") pero UNA sola frase corta antes de seguir con el
       tema que estaba abierto.
     - Si tu último mensaje quedó en una pregunta, no la repitas literal:
       reformúlala o avanza a la siguiente si el cliente la esquivó.`;
```

E interpolar `openerBlock` donde antes iba el texto fijo del OPENER.

### 3. Reforzar con `turnDirective` (código, no prompt)
En `buildTurnDirective` / justo antes de construir `systemPromptFinal` (línea 1141), añadir un aviso corto cuando `hasBotReplied === true`:

```
[TURNO ACTUAL · CONTINUACIÓN] Ya hay N mensajes previos del equipo en este
hilo (último hace X h). NO te presentes. NO preguntes el nombre. Usa
"${saludoHorario}" si vas a saludar.
```

Esto sirve de doble candado por si el modelo ignora el prompt largo.

## Verificación

1. Después de aplicar el fix, invocar manualmente `wa_ai_reply` sobre una `conversation_id` con historial largo (por ejemplo la del propio Jaime) y comprobar en `edge_function_logs` que el borrador generado NO contiene "soy Jaime", "con quién tengo el gusto" ni "buenas noches" antes de las 21:00.
2. Revisar `wa_messages` recientes de esa conversación tras un nuevo `wa_replay_deferred`: la primera respuesta out del día debe retomar el hilo, no saludar desde cero.

## Fuera de alcance

- No tocamos el scoring, ni el checklist de KPIs, ni `wa_bot_config` (horario 09:00–20:30 se mantiene).
- No cambiamos modelos ni `max_tokens`.
- No añadimos tablas ni migraciones.

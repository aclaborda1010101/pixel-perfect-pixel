# Briefing IA accionable y visual para "Preparar llamada"

## Problema

En `/comercial/preparar/:ownerId` el botón "Briefing IA" muestra un volcado JSON en bruto. Pasa porque la edge function `agent_pre_call_brief` devuelve el esquema antiguo (`contexto`, `objetivos`, `preguntas_clave`, `riesgos`, `proxima_accion_sugerida`, `confianza`) y la UI espera `resumen` / `puntos_clave` / `approach`, así que cae al `<pre>JSON.stringify</pre>`. Además el brief no aprovecha históricos del propietario ni contexto comparativo cuando no hay datos.

## Objetivo

Que Jesús abra el briefing y entienda en 5 segundos:
1. Quién es y en qué punto estamos.
2. Qué decir en los primeros 20 segundos.
3. Qué objeciones esperar y cómo responder.
4. Cuál es la próxima acción concreta.

Con dos modos automáticos:
- **Con histórico** → tips basados en sus llamadas (mejor franja, último outcome, patrones de no-respuesta, temas tratados).
- **Sin histórico** → playbook de primer contacto + contexto agregado de propietarios comparables (mismo edificio / misma zona / mismo perfil).

## Cambios

### 1. `supabase/functions/agent_pre_call_brief/index.ts`

Reescribir el agente para que:

- Cargue además:
  - `building_owners` del edificio del owner + sus `calls` (peers) → agregados: nº propietarios, % contactados, mejor franja horaria de contacto efectivo, outcomes más frecuentes.
  - `notas_simples.structured_json` más reciente del owner → cargas/embargos, % propiedad, divisibilidad.
  - Stats propias del owner: nº intentos, último outcome, franjas horarias usadas, gap desde último intento.
- Detecte modo `con_historico` vs `primer_contacto` en base a si hay llamadas con `resumen` real (no solo intentos sin respuesta).
- Devuelva esquema nuevo vía tool calling estructurado:

```ts
{
  modo: "con_historico" | "primer_contacto",
  confianza: number,                    // 0..1
  resumen: string,                      // 1-2 frases
  estado_relacion: string,              // "frío", "tibio (1 conversación)", etc.
  intencion_llamada: string,            // objetivo nº1 de ESTA llamada
  mejor_momento: { franja: string, razon: string } | null,
  openers: string[],                    // 2-3 frases de apertura listas para leer
  preguntas_clave: string[],            // 3-5
  objeciones: Array<{ objecion: string, respuesta: string }>, // 3
  tips: Array<{ tipo: "historico" | "patron_peers" | "buena_practica", texto: string }>,
  riesgos: string[],
  proxima_accion: string,
  contexto_peers: string | null         // sólo si modo=primer_contacto
}
```

- System prompt en castellano, conciso, orientado a originación inmobiliaria, distinguiendo los dos modos.
- Mantener el insert en `agent_runs` igual.

### 2. `src/pages/comercial/PrepararLlamada.tsx`

Sustituir el bloque `{brief && (<Card>…)}` por una sección visual nueva (sin tocar las otras tarjetas ni el post-llamada):

```text
┌─ Briefing IA ────────────────────────────────────────────┐
│ Modo: [Primer contacto | Con histórico]  Confianza ▮▮▮▯ │
├──────────────────────────────────────────────────────────┤
│  ▸ Resumen (1-2 líneas grandes)                          │
│  ▸ Intención de la llamada (chip dorado)                 │
│  ▸ Estado relación · Mejor momento                       │
├─── 2 columnas ───────────────────────────────────────────┤
│ Openers (cards con botón copiar) │ Preguntas clave (lista)│
│                                  │ Objeciones (acordeón) │
├──────────────────────────────────────────────────────────┤
│ Tips (badges por tipo: histórico / peers / buena práctica)│
│ Riesgos (lista con icono alerta)                          │
│ Contexto peers (sólo si primer contacto)                  │
│ Próxima acción (CTA destacada)                            │
└──────────────────────────────────────────────────────────┘
```

Detalles:

- Cabecera con `Badge` para `modo`, barra de confianza (4 dots) y botón "Regenerar".
- `Openers` como tarjetas pequeñas con botón `Copiar` (clipboard) e icono `Quote`.
- `Objeciones` en `Accordion` (objeción ↑ / respuesta ↓), tono rojo suave.
- `Tips` con icono distinto por tipo: 📈 histórico (gold), 👥 peers (info), 💡 buena práctica (muted).
- Si el agente devuelve el esquema viejo (fallback), mapear `contexto→resumen`, `proxima_accion_sugerida→proxima_accion`, etc., antes de pintar, para no volver a romper.
- Loading skeleton mientras `loadingBrief`.
- Todo con tokens del design system oscuro (`gold`, `border-faint`, `surface-1`, `gold-soft`). Sin colores literales.

### 3. Sin cambios de DB ni de RLS

No se tocan tablas ni vistas. Sólo edge function + UI.

## Validación

- Abrir `/comercial/preparar/<owner sin llamadas>` → modo `primer_contacto`, ver openers + contexto peers.
- Abrir `/comercial/preparar/<owner con 7 intentos>` (caso actual) → modo `con_historico`, tip sobre cambiar franja horaria, riesgo de saturación, próxima acción concreta.
- Confirmar que ya no aparece el bloque `<pre>JSON</pre>`.

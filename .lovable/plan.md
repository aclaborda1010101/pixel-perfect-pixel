## Reescritura del bot de WhatsApp según el documento interno Afflux

Aplicar el árbol de conversación, las 4 tácticas Voss, el Fair Exchange (DeMartini), los 7 espejos y el mapeo a HubSpot. Cambios concentrados en `wa_ai_reply` + ampliación de `qualification` + propagación a HubSpot. **Sin tocar** escaleras-visor, scoring, P0, ni Inbox/Historial UI.

### 1. Nuevo system prompt en `supabase/functions/wa_ai_reply/index.ts`

Sustituir el prompt actual (Lucía/Voss genérico) por el guion Afflux con:

- **Identidad**: asistente de Afflux, tuteo cambiado a **"usted"**, tono calmado, sin presión.
- **Regla maestra Fair Exchange**: cada pregunta paga algo al propietario en el mismo mensaje (claridad, dato de mercado, cálculo, validación emocional). Si no hay nada que dar, no se pregunta.
- **Tácticas permitidas en texto**: calibradas ("qué/cómo", nunca "por qué"), etiquetado, preguntas orientadas al "no", hecho-por-hecho. Prohibido encadenar preguntas.
- **Líneas rojas** literales del doc: nada de nombres/teléfonos de terceros, nada de cifras de compra, nada de asesoría legal por chat, no insistir si esquiva.
- **5 fases con objetivo, táctica y datos a extraer** (tabla del doc).
- **7 espejos** con señal de detección, etiqueta disparadora, preguntas calibradas y cierre adaptado de cada uno (copiar literal del doc).
- **Fase 4 sensible**: 4 preguntas orientadas al "no" para inferir dinámica/conflicto/cobertura sin pedir nombres.
- **Cierre Fase 5**: siempre pregunta orientada al "no" hacia reunión.

### 2. Ampliar `qualification_update` que devuelve el modelo

Reemplazar los 5 campos actuales por el set completo del doc. JSON estricto:

```ts
{
  fase_actual: 0|1|2|3|4|5,
  estado_edificio?: "alquilado"|"vacio"|"mixto",
  renta_mensual_estimada?: number,   // €/mes aprox
  gestion_rentas?: "contacto"|"otro"|"nadie",
  tipologia_proindivisario?: "01"|"02"|"03"|"04"|"05"|"06"|"07",
  cuota_participacion?: number,       // %
  motivacion_principal?: string,      // libre, guiado por el espejo
  urgencia?: "alta"|"media"|"baja",
  decide_solo?: "si"|"no"|"explorando",
  num_copropietarios?: number,
  dinamica_decision?: "consenso"|"un_lider"|"bloqueo",
  nivel_conflicto?: "bajo"|"medio"|"alto",
  cobertura_edificio?: string,        // aliados potenciales SIN nombres
  interes_reunion?: "si"|"agendar"|"seguimiento",
  oportunidad_flags?: string[]        // señales detectadas (ver §4)
}
```

Mantener la regla actual de no sobrescribir lo ya conocido y de no inventar.

Eliminar los campos viejos (`gestiona_edificio`, `tiene_cuadro_rentas`, `vive_en_edificio`, `relacion_copropietarios`) del prompt — quedan obsoletos. `nombre_apellidos` se conserva.

### 3. Detección de tipología (espejo) y rama

El modelo, al cerrar Fase 2, fija `tipologia_proindivisario` con la regla "señal de detección → etiqueta → confirmación tácita del propietario". A partir de ahí el prompt instruye usar las preguntas de la rama correspondiente y NO mezclar espejos.

`rol_inferido` (que ya existe en `wa_conversations`) se mantiene en paralelo: el espejo Afflux es comercial, el `rol_owner` (particular/heredero/inversor…) sigue alimentando el CRM. La IA puede actualizar ambos.

### 4. Señales de OPORTUNIDAD (Proceso 4)

Calcular server-side tras merge de `qualification` (no fiarlo al modelo):

- `bloqueo + conflicto_alto` → flag `fragmentacion`.
- `decide_solo=si` y espejo en {02,03} → flag `cuota_accionable`.
- espejo 07 + `cobertura_edificio` no vacío → flag `compra_multiple`.
- `urgencia=alta` + motivación en {salir, dignidad, liberar_carga} → flag `listo_para_mover`.

Guardar en `wa_conversations.qualification.oportunidad_flags` y, si hay ≥1, marcar `wa_contacts.stage='caliente'`. Disparar `wa_summarize` con `force:true` cuando aparezca una flag nueva.

### 5. Mapeo a HubSpot

Nuevo edge function (o extender el existente de sincronización) `wa_sync_hubspot` que, al consolidar `qualification`, mapea a las propiedades del doc vía gateway HubSpot:

| qualification | propiedad HubSpot |
|---|---|
| estado_edificio | estado_edificio |
| renta_mensual_estimada | renta_mensual_estimada |
| gestion_rentas | gestion_rentas |
| tipologia_proindivisario | tipologia_proindivisario |
| cuota_participacion | cuota_participacion |
| motivacion_principal | motivacion_principal |
| urgencia | urgencia |
| decide_solo | decide_solo |
| num_copropietarios | num_copropietarios |
| dinamica_decision | dinamica_decision |
| nivel_conflicto | nivel_conflicto |
| cobertura_edificio | cobertura_edificio |
| interes_reunion | interes_reunion |
| oportunidad_flags | oportunidad (multi-select) |

Se actualiza solo cuando cambia algún campo. Requiere que las propiedades existan en HubSpot — primer paso: verificar con `hubspot/crm/v3/properties/contacts` y reportar las que falten para crearlas manualmente (no las creo yo sin tu OK).

### 6. Ajuste de auto-stage

`wa_contacts.stage` actual ("nuevo→conversando→cualificado→caliente→handoff"):
- `conversando` al primer reply (igual que hoy).
- `cualificado` cuando haya `tipologia_proindivisario` + 3 campos de Fase 1-2.
- `caliente` cuando aparezca cualquier `oportunidad_flag` o `interes_reunion='si'`.

### 7. Validación

- Reproducir 3 conversaciones reales recientes con `force:true` (incluida la CMC) y verificar que el bot:
  - Usa "usted".
  - No encadena preguntas.
  - Entrega valor antes de pedir.
  - Detecta espejo correctamente.
  - Devuelve `qualification_update` con los campos nuevos.
- Comprobar que las flags de oportunidad se calculan y que `wa_summarize` se dispara.

### Archivos a tocar

- `supabase/functions/wa_ai_reply/index.ts` — prompt + parseo de qualification + cálculo de flags + auto-stage.
- `supabase/functions/wa_sync_hubspot/index.ts` — **nuevo**, mapeo a HubSpot.
- `supabase/functions/wa_summarize/index.ts` — incluir nuevos campos en el resumen.
- Sin cambios de schema en Supabase (todo cabe en `wa_conversations.qualification jsonb`).

### Fuera de alcance

Escaleras-visor, scoring P0, Revisión de escaleras, CRM general, UI de Inbox/Historial. Si quieres también pintar los campos nuevos en la ficha del lead del Inbox, lo hacemos en un segundo plan.

¿Le doy con esto? Si HubSpot no debe tocarse aún o ya hay otro mecanismo de sincronización, dímelo y dejo solo §1-§4 + §6.
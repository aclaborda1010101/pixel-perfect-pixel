# Plan — Ampliación del sistema de feedback por edificio

Extiendo lo que ya existe (`TeamFeedbackCard`, tabla `building_feedback`, `agent_analyze_feedback`, panel Aprendizaje). No duplico componentes ni rehago la captura voz/texto.

## 1. Controles de validación inline en `BuildingDetail` / `EdificioDetalle`

Nuevo componente reutilizable `src/components/comercial/InlineVerify.tsx` con dos variantes:

- `<InlineVerifyBool>` — para esquina: `[Correcto] [No, es esquina] [No, no es esquina]`.
- `<InlineVerifyNumber>` — para ventanas fachada/patio, escaleras, nº propietarios: `[Sí, correcto] [No, ajustar → input numérico → Guardar]`.
- `<InlineVerifyEnum>` — para cluster/clasificación y protección: `[Correcto] [Otra: select/free text]`.

Props: `buildingId`, `dimension`, `campo` (tabla.campo), `valor_actual`, `detector` (string que identifica el método: `corner-detector`, `stair-detector`, `facade-window`, `patio-window`, `cluster`, `proteccion`), `opciones?`.

Al pulsar:
1. Inserta en `building_feedback` con `canal='verificacion_inline'`, `texto` autogenerado (ej. `"Verificación humana: esquina=true (sistema decía false)"`), y un nuevo campo `metadatos jsonb` con `{ detector, campo, valor_actual, valor_humano, accion: 'confirma' | 'corrige' }`.
2. Upsert en `qa_ground_truth` para ese `building_id` + campo (verdad humana).
3. Llama `agent_analyze_feedback` automáticamente solo si `accion='corrige'` (para sacar diagnóstico de método).
4. Si `accion='confirma'`, no se invoca el LLM (solo se guarda fixture y feedback corto en estado `aplicada`).

Inserción de los controles en `BuildingDetail.tsx` y `EdificioDetalle.tsx` junto a:
- Ventanas fachada / patio (en `AnalisisIASection` o card de ventanas).
- Esquina (en `AnalisisPlanoCatastralCard` / chip de esquina).
- Cluster (en `ScoringResumen`).
- Escaleras, protección, nº propietarios (en `CatastroDetalladoCard` y sección protección).

## 2. Cuadro libre texto+audio

Ya existe en `TeamFeedbackCard`. Solo amplío el `placeholder` del `Textarea` con ejemplos rotatorios y añado un bloque de "ejemplos rápidos" clicables que rellenan el textarea (chips: *"es esquina y no lo dice"*, *"clasificación coliving es incorrecta, viviendas demasiado grandes"*, *"las escaleras son 2"*, *"no es protegido"*). No duplico la grabación.

## 3. Reescritura de `agent_analyze_feedback` — diagnóstico de MÉTODO

Reescribo el `SYSTEM` prompt y el `snapshot` que recibe el LLM para que devuelva un JSON con esta forma estricta:

```json
{
  "dimension": "esquina|escaleras|ventanas|cluster|proteccion|propietarios|m2|viviendas|otro",
  "detector": { "nombre": "corner-detector", "ubicacion": "supabase/functions/_shared/parcel_geometry.ts" },
  "entrada": { "fuente": "FXCC pdf p.1 + cadastral polygon", "regla_usada": "ángulo 60-120° entre 2 fachadas" },
  "causa_raiz": "edificio en chaflán: paño único, no hay 2 segmentos con ángulo en rango",
  "que_cambiar": {
    "tipo": "regla|prompt|constante|umbral|dato_sucio|requiere_codigo",
    "detalle": "Cambiar criterio principal a 'nº de viales distintos con frente' y mantener ángulo como señal secundaria",
    "donde": "parcel_geometry.ts::detectCorner / app_settings.corner_detection"
  },
  "override_puntual": { "aplicable": true, "tabla": "building_analysis", "campo": "es_esquina", "valor_nuevo": true, "justificacion": "..." },
  "diagnostico": "frase humana corta"
}
```

Cambios concretos en `supabase/functions/agent_analyze_feedback/index.ts`:
- Enriquecer el `snapshot` con: qué detector produjo cada campo (mapeo dimensión→detector→archivo), `metadatos` del feedback (si viene de InlineVerify ya trae el detector), y trazas existentes (`protegido_raw`, `origen_viviendas`, `notas_correccion`).
- Nuevo SYSTEM que obliga al LLM a centrarse en el **método**, no en el dato. Incluyo catálogo de detectores conocidos para que el modelo escoja:
  - `stair-detector` (`recount-escaleras`, `analyze-building-vision` planta 1)
  - `corner-detector` (`recompute-corner-detection`, `_shared/parcel_geometry.ts`)
  - `facade-window` (`count-facade-windows`)
  - `patio-window` (`count-patio-windows`)
  - `cluster` (`recompute-cluster-scoring`)
  - `proteccion` (`check-proteccion-pgou` + `madrid_edificios_protegidos`)
- El campo `accion` legacy se mantiene por compatibilidad con `TeamFeedbackCard` y `apply_feedback_override` (mapeo desde `override_puntual`).
- `estado` final:
  - `analizada` si hay `override_puntual.aplicable=true`.
  - `requiere_codigo` si `que_cambiar.tipo='requiere_codigo'` o cambio de regla/constante.
  - Nuevo: si `que_cambiar.tipo='constante'` y la constante existe en `app_settings`, dejarlo en `requiere_codigo` con sugerencia del nuevo valor (no auto-aplicar).

## 4. Fixtures en `qa_ground_truth`

- Tras cada validación inline (confirma o corrige) y tras cada `apply_feedback_override`, upsert en `qa_ground_truth` con `{ building_id, campo, valor_humano, fuente='verificacion_inline'|'feedback_libre', verificado_por, verificado_at }`.
- Helper compartido `src/lib/qaGroundTruth.ts` con `upsertGroundTruth(buildingId, campo, valor, fuente)`.

## 5. Migración

Una migración añade a `building_feedback`:
- `metadatos jsonb default '{}'::jsonb` (detector, valor_actual, valor_humano, accion).
- check ampliado de `canal` para incluir `'verificacion_inline'`.

No toco RLS (las policies existentes ya cubren insert/select por usuario autenticado).

## 6. Render del diagnóstico de método en `TeamFeedbackCard`

Amplío el `<details>Análisis IA</details>` para mostrar las nuevas secciones: **Detector**, **Entrada usada**, **Causa raíz**, **Qué cambiar** (con badge según `tipo`), y solo entonces el botón **Aplicar override** si `override_puntual.aplicable`.

## 7. Validación end-to-end

- Crear un feedback de prueba en Cava Baja 42: *"es esquina y el sistema dice que no"* → llamar `agent_analyze_feedback` → mostrar el JSON devuelto (espero `detector=corner-detector`, `causa_raiz` chaflán, `que_cambiar.tipo='regla'` apuntando a `parcel_geometry.ts`, `override_puntual.aplicable=true`).
- Reportar el resultado al usuario.

## Detalles técnicos

- Archivos nuevos: `src/components/comercial/InlineVerify.tsx`, `src/lib/qaGroundTruth.ts`, una migración SQL.
- Archivos modificados: `supabase/functions/agent_analyze_feedback/index.ts`, `src/components/comercial/TeamFeedbackCard.tsx` (render + chips de ejemplos), `src/pages/BuildingDetail.tsx`, `src/pages/comercial/EdificioDetalle.tsx`, y las cards donde se muestran ventanas/esquina/cluster/escaleras/protección/propietarios.
- Sin cambios en RLS.
- Modelo LLM: mismo `google/gemini-3-flash-preview` con `response_format: json_object`.


## Objetivo
Botón "Dar de alta nuevo edificio" en `/comercial/edificios` que arranca el flujo completo de la skill `titulares-edificio-hubspot` hasta dejar el edificio listo con titulares verificados y enriquecidos. Cierra los huecos detectados en la auditoría (paso 6 HubSpot, paso 7 reglas runtime, paso 8 dedupe).

## 1. UI — Alta nuevo edificio
- Botón **"Dar de alta nuevo edificio"** en cabecera de `src/pages/comercial/Edificios.tsx` (junto al buscador).
- Dialog `NewBuildingDialog` con:
  - Dirección (obligatoria, autocompleta contra `buildings` para evitar duplicados; si coincide, ofrece "Abrir existente").
  - Ciudad / barrio / distrito (opcionales, autodetectables luego por catastro).
  - Referencia catastral (opcional).
  - Upload directo de la nota simple PDF (reutiliza `useNotasSimples.upload`).
- Al crear: `INSERT buildings`, sube PDF, llama `analyze_nota_simple`, redirige a `/comercial/edificios/:id` con pestaña "Enriquecimiento" activa.

## 2. Orquestación — pipeline automática
- Tras `analyze_nota_simple` completa (`status=listo`), trigger automático de `enrichment-pipeline-start` con el `building_id` recién creado (hoy ya existe la función, pero es manual).
- Añadir hook DB o llamada en cadena desde el dialog para no depender de cron.

## 3. Cierre paso 6 — escritura HubSpot
Nueva edge function `enrichment-write-hubspot` invocada por `enrichment-apply-verification` cuando `decision=aprobada`:
- Si titular es **empresa**: `POST /crm/v3/objects/companies` (dedupe por CIF en `external_ids`).
- Si titular es **persona**: `POST /crm/v3/objects/contacts` (dedupe por NIF / email).
- Asociar contacto/empresa al **deal** del edificio (`hubspot_deal_id` en `buildings`).
- Adjuntar PDF de nota simple como **nota/engagement** en el deal.
- Crear **tarea Tecnofind** en HubSpot si falta teléfono (hoy solo se crea local en `building_tasks`).
- Guardar `hubspot_contact_id` / `hubspot_company_id` en `external_ids`.
- Marca `fase=completado` al terminar.

## 4. Cierre paso 7 — reglas T1–T10 aplicadas en runtime
- `enrichment-apply-verification` lee `enrichment_config.reglas` y aplica el mapa (hoy hardcodea T9/T8).
- Añadir detección de **fallecido** (heurística: nota simple menciona "herederos de" / "causahabientes") → tipología T10 automática.
- Completar entradas faltantes en el panel de reglas (T1 propietario único, T2 copropietario, T4 usufructuario, T5 nuda propiedad, T6 empresa patrimonial, T7 apoderado sin control).

## 5. Cierre paso 8 — dedupe e idempotencia
- Migración: `UNIQUE (building_id, titular_nif)` y `UNIQUE (building_id, lower(titular_nombre), nota_simple_id)` en `enrichment_jobs`.
- `owners` dedupe por NIF (no solo nombre); fallback a nombre normalizado (sin tildes, lowercase).
- `enrichment_verifications`: una sola fila vigente por `job_id` (`UNIQUE (job_id) WHERE decision != 'pendiente'`).

## 6. Refuerzo Inglobaly (paso 3)
- Reescribir selectores Playwright-style (`a:has-text`) → puppeteer-core válido (`page.$x` XPath o `page.evaluate` con `textContent`).
- Sin nota simple no se lanza Inglobaly; con `BROWSER_WSS_URL` ya configurado, primera prueba real captura screenshots de fallo para ajustar selectores reales del portal.

## 7. UI Verificación (paso 5 — ya parado, faltan controles)
- Página `/admin/verificacion-titulares` con cola de `enrichment_verifications` pendientes.
- Por cada job: mostrar titular, datos datoscif, datos Inglobaly, co-domicilios, tipología propuesta, screenshots.
- Acciones: **Aprobar** / **Rechazar con motivo** / **Editar y aprobar** (overrides) → llama `enrichment-apply-verification`.

## Detalles técnicos
- **Tablas nuevas**: ninguna. Cambios sólo en constraints `enrichment_jobs` y `enrichment_verifications`.
- **Edge functions**:
  - Nueva: `enrichment-write-hubspot`.
  - Modificadas: `enrichment-apply-verification` (leer reglas, invocar write-hubspot), `enrichment-agent` (selectores Inglobaly), `analyze_nota_simple` (callback a `enrichment-pipeline-start`).
- **Front**: `NewBuildingDialog`, botón en `Edificios.tsx`, página verificación en `src/pages/admin/`.
- **HubSpot**: usa `_shared/hubspot.ts` ya existente (gateway Lovable, no SDK directo).
- **Validación final**: alta de Ambros 28 end-to-end → debe terminar con titulares en BD, contactos en HubSpot, deal asociado, nota adjunta.

## Orden de ejecución
1. UI alta edificio + auto-trigger pipeline (rápido, desbloquea pruebas).
2. Dedupe constraints (evita basura en pruebas).
3. Reglas T1–T10 runtime.
4. Selectores Inglobaly + prueba real con screenshots.
5. UI cola de verificación.
6. Escritura HubSpot.

## Fuera de alcance
- Detección automática de fallecido más allá de heurística textual (queda para iteración).
- Refresh periódico de datos Inglobaly (one-shot por alta).
- Migración masiva de los edificios ya existentes sin nota simple.

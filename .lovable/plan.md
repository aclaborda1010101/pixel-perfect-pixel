
# BLOQUE F5 (rev) · Pipeline autónomo de enriquecimiento de titulares

Cambio clave: agente cron drena la cola sin operador externo. Navegador headless remoto (Browserless/Browserbase) vía `puppeteer-core` + WebSocket. Endpoint REST queda como fallback secundario, no principal.

---

## 1. Esquema de datos (migración nueva, RLS intacta)

### `enrichment_jobs`
- `id uuid pk`, `building_id uuid → buildings`, `nota_simple_id uuid → notas_simples`
- `titular_nombre text`, `titular_apellido1 text`, `titular_apellido2 text`
- `titular_tipo text check ('persona','empresa')`, `titular_nif text`, `titular_pct numeric`
- `fase text check ('datoscif','inglobaly','tecnofind','verificacion','hubspot')`
- `estado text check ('pendiente','en_curso','esperando_navegador','requiere_revision','requiere_humano','ok','error','descartado')`
- `datos jsonb default '{}'` — payload acumulado (NIF, fecha_nacimiento ISO, domicilio, co_domicilios[], cargo, fuente, timeline[], screenshots[])
- `intentos int default 0`, `max_intentos int default 3`, `next_attempt_at timestamptz`, `error text`
- `lease_token uuid`, `lease_until timestamptz` (para fallback REST)
- `created_at`, `updated_at`
- Indexes: `(estado, fase, next_attempt_at)`, `(building_id)`
- GRANTs: SELECT/INSERT/UPDATE a `authenticated`, ALL a `service_role`
- RLS: `authenticated` ve/edita según rol comercial/admin; agente entra como `service_role`

### `enrichment_config` (k/v jsonb, 1 fila)
Reglas tipologías editables (defaults: `co_domicilio→T8`, `apoderado_con_control→T3`, `default→T9`, `fallecido→T10`), timeouts por fase, max_intentos, backoff.

### `enrichment_verifications`
`id`, `job_id`, `propuesta jsonb`, `decision ('aprobada','rechazada','pendiente')`, `aprobado_por`, `aprobado_at`, `motivo`.

### Bucket `enrichment-evidence` (privado)
Screenshots por paso: `evidence/{job_id}/{fase}/{step}.png`. Política: solo `authenticated` con rol admin/comercial lee; `service_role` escribe.

---

## 2. Edge functions

### `enrichment-agent` (cron pg_cron cada 15 min)
Drena cola por orden `next_attempt_at`. Para cada job:

1. Lease (UPDATE WHERE estado='pendiente' RETURNING) → `en_curso`.
2. Despacha por fase:
   - **datoscif**: fetch HTML `https://www.datoscif.es/empresa/<slug>`. Parse regex/DOMParser. Si client-rendered sin datos → fallback navegador headless. Si OK → guarda CIF/admin/apoderados, avanza a `inglobaly`.
   - **inglobaly** (persona): requiere navegador headless. Si no hay `BROWSER_WSS_URL` → `esperando_navegador` con `datos.razon='browser_no_configurado'`. Si hay → flujo selectores (ver §5).
   - **tecnofind**: si falta teléfono crea `building_tasks` "Buscar teléfono en Tecnofind" y avanza a `verificacion` (no automatizamos Tecnofind por fragilidad).
   - **verificacion**: STOP humano (no toca HubSpot).
3. Robustez en cada paso navegador:
   - Timeout duro 90s/paso.
   - Screenshot `await page.screenshot()` → sube a `enrichment-evidence` → push a `datos.screenshots[]`.
   - Si selector no aparece → `requiere_revision` con screenshot y `datos.razon='selector_no_encontrado'`. **Nunca inventa datos.**
   - Errores: `intentos++`, `next_attempt_at = now() + backoff(intentos)` (1m, 5m, 30m), tras `max_intentos` → `error`.
4. Cierra browser y libera lease.

### `enrichment-pipeline-start` (manual / botón UI)
POST `{building_id}` → genera jobs desde nota simple más reciente, fase inicial según `titular_tipo`. Invoca `enrichment-agent` inmediatamente (no espera al cron).

### `enrichment_jobs_api` (REST fallback secundario, autenticado con service key)
Documentado en panel. Solo se usa si el cron está desactivado o el navegador caído más de 1h:
- `GET /pending?fase=&limit=` con `claim_token`.
- `POST /result` con payload validado.

### `enrichment-apply-verification`
POST `{job_id, decision, overrides}`:
- Aprobar → upsert `owners` + `building_owners` (pct, NIF, fecha_nacimiento, domicilio), co-domicilios como contactos `subrole='co_domicilio_sin_confirmar'` con metadatos T8, tarea Tecnofind si falta tel, regla tipología por defecto T9.
- Solo entonces avanza a fase `hubspot` (usa funciones HubSpot existentes).

### Cron (insertar vía `supabase--insert`, no migración)
```sql
select cron.schedule('enrichment-agent-15min','*/15 * * * *',
  $$ select net.http_post(
    url:='https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/enrichment-agent',
    headers:='{"Content-Type":"application/json","apikey":"<ANON>"}'::jsonb,
    body:='{}'::jsonb) $$);
```

---

## 3. Secrets requeridos (pedir vía add_secret)
- `BROWSER_WSS_URL` — wss://... de Browserless/Browserbase
- `INGLOBALY_USER`, `INGLOBALY_PASS`
- (existente) `LOVABLE_API_KEY`, HubSpot connector

Hasta que el usuario los configure, los jobs `inglobaly` quedan `esperando_navegador`; el panel muestra aviso con instrucciones (crear cuenta Browserless gratuita, copiar Browser WSS, pegar en Settings).

---

## 4. Flujo selectores Inglobaly (documento técnico)

```text
1. goto https://www.inglobaly.com → click "Acceso"
2. fill #usuario / #password con INGLOBALY_USER/PASS → submit, esperar dashboard
3. Si titular_nif:
     ir a búsqueda NIF, fill input NIF → enviar
   Else:
     búsqueda por nombre modo EXACT (NO Advanced):
     fill Nombre, Apellido1, Apellido2 → enviar
4. Esperar tabla resultados; si 0 → requiere_revision
5. Click primera ficha
6. Extraer cabecera: NIF, fecha nacimiento DD/MM/AAAA → convertir a YYYY-MM-DD
7. Extraer "Domicilio actual" + "Domicilio anterior":
   - Por cada domicilio, lista de convivientes
   - Dedupe por NIF en co_domicilios[]
8. Screenshot final → datos.screenshots[]
9. Avanzar a fase tecnofind
```
Cada `waitForSelector` con timeout 15s; si falla → screenshot + `requiere_revision`.

---

## 5. UI

### Página `/comercial/enriquecimiento` (nueva)
- KPIs: jobs por estado.
- Banner amarillo si `BROWSER_WSS_URL` no configurado, con CTA "Configurar Browserless" → Settings.
- Tabla agrupada por edificio (uso de `useTableQuery`):
  - Columnas: titular, fase, estado (badge), intentos, último error, próx. reintento.
  - Acciones: Ver datos (drawer con JSON + galería de screenshots firmados), Reintentar, Forzar revisión humana, Cancelar.
- Botón "Procesar edificio" en `BuildingDetail` → `enrichment-pipeline-start`.
- Sección colapsable "Contrato API operador externo (fallback)" con ejemplos curl.

### Modal Verificación T1-T10 (fase `verificacion`)
- Editable: nombre, NIF, fecha_nacimiento, domicilio, cargo, tipología (select T1-T10, default T9), co-domicilios (toggle "crear T8 sin confirmar").
- Botones Aprobar / Rechazar (con motivo). Solo Aprobar dispara HubSpot.

### Panel Settings → "Reglas tipologías enriquecimiento"
Tabla editable persistida en `enrichment_config.reglas`.

---

## 6. Validación

1. Pedir secrets `BROWSER_WSS_URL`, `INGLOBALY_USER`, `INGLOBALY_PASS` (sin valores aún → quedan vacíos, OK).
2. Crear job ficticio:
   - Empresa "INMOBILIARIA FICTICIA SL" fase `datoscif` → agente intenta, datoscif devuelve no-encontrado → `requiere_revision` con screenshot.
   - Persona "Juan Pérez Pérez" fase `inglobaly` → si no hay `BROWSER_WSS_URL` → `esperando_navegador`. Si está → flujo selectores (probable `requiere_revision` por persona ficticia).
3. Insertar manualmente datos en `enrichment_verifications` y aprobar → owner upsert + tarea creada + fase `hubspot`.
4. Mostrar timeline de estados.

---

## 7. Detalles técnicos

- `puppeteer-core` vía `npm:puppeteer-core@22` en Deno. Conexión `puppeteer.connect({ browserWSEndpoint: BROWSER_WSS_URL })`. Cerrar en `finally`.
- Screenshots → `supabase.storage.from('enrichment-evidence').upload(...)`, signed URL para UI.
- `datos.timeline`: `[{ts, fase, estado, nota, screenshot?}]`.
- Cron usa `pg_cron`+`pg_net` (habilitar si no lo están).
- Sin tocar RLS existente; nuevas tablas tienen RLS propio coherente con `user_roles`.

## Fuera de scope
- Scraping Tecnofind automatizado (queda como tarea humana).
- Validación NIF AEAT.
- Push HubSpot sin aprobación humana.

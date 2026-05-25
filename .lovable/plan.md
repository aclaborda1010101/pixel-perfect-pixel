
## Objetivo

Conseguir que, para cada edificio del CRM (empezando por los 74 de tu cartera), se descargue el PDF oficial "Documento de la distribución por plantas de la parcela" del Catastro y se adjunte a la ficha del edificio, como pasa con el de ejemplo (`0382201VK4708C0001IZ`, 7 páginas).

## Diagnóstico

El edge function `fetch-catastro-data` ya tiene toda la maquinaria (descarga, subida a Storage bucket `catastro`, rasterización con MuPDF, columnas `plantas_pdf_url`, `plantas_pages_urls`, `plantas_num_pages`, `plantas_pdf_disponible`). El único punto débil son las URLs candidato (`GeneraDocPlantas.aspx`, etc.) — el Catastro no expone el PDF en esos endpoints, por eso siempre cae al fallback SVG.

La URL real del enlace "Documento de la distribución por plantas (PDF)" que ves en el popup del mapa es:

```
https://www1.sedecatastro.gob.es/Cartografia/GeneraGraficoParcela.aspx?
   refcat={REFCAT14}&del={DEL}&mun={MUN}&TipoDocumento=plantas&formato=pdf
```

con dos variantes equivalentes (`/Cartografia/GeneraGrafico.aspx` con `tipoCartografia=plantas`) y un parámetro `del`/`mun` que NO se puede dejar vacío como hace el código actual — hay que sacarlo de la propia refcat o de la primera llamada al mapa (la response trae los hidden inputs `del` y `mun`).

## Plan de cambios

### 1. `fetch-catastro-data` (edge function)

a. **Resolver `del` y `mun`** antes de pedir el PDF:
   - llamar a `mapa.aspx?refcat={refcat}` (ya se hace en `discoverPlantasPdfUrl`)
   - extraer del HTML los `name="ctl00$..."` con `del` y `mun` (regex)
   - guardarlos en `catastro_data.metadatos.del / mun`

b. **Nuevas URLs candidato** (en orden, primera que devuelva `%PDF` gana):
   ```
   /Cartografia/GeneraGraficoParcela.aspx?refcat={REFCAT}&del={DEL}&mun={MUN}&TipoDocumento=plantas&formato=pdf
   /Cartografia/GeneraGrafico.aspx?refcat={REFCAT}&del={DEL}&mun={MUN}&tipoCartografia=plantas&formato=pdf
   /Cartografia/GeneraDocumentoFXCC.aspx?refcat={REFCAT}&tipoDoc=plantas
   ```
   Mantener el `discoverPlantasPdfUrl()` como último fallback (parseando los `href` del popup).

c. **Validar PDF "de plantas"** no cualquier PDF: chequear que `pdfBuf` contiene al menos 2 páginas y > 30KB; si no, marcar `fetch_quality='low'` y dejar el SVG.

d. **Guardar URL original del Catastro** en `catastro_data.metadatos.plantas_pdf_source_url` (auditabilidad — para que el comercial pueda abrir el original).

e. **Subir PDF + PNGs** ya se hace; verificar que el bucket `catastro` es público (lo es).

### 2. UI ficha edificio (`AnalisisPlanoCatastralCard.tsx`)

Añadir, encima del SVG/imágenes actuales:
- Botón **"📄 Descargar PDF distribución por plantas (N páginas)"** → `plantas_pdf_url`
- Grid de thumbnails una por página (`plantas_pages_urls[]`), click → lightbox
- Si `plantas_pdf_disponible=false`: badge gris "PDF no disponible en Catastro — solo croquis"
- Link "Ver en Catastro" → `metadatos.plantas_pdf_source_url`

### 3. Lanzar el proceso

Una vez verificado con el caso de validación (Topete 33 → 7 páginas), añadir botón en `/comercial/edificios` arriba a la derecha:

**"🔄 Refrescar Catastro de mi cartera (74)"**
que llama a `fetch-catastro-data` con `force=true` para cada `building_id` asignado al usuario (concurrencia 2, sleep 2s entre lotes, progreso visible). Idempotente — si ya tiene `plantas_pdf_disponible=true` lo salta salvo `force`.

### 4. Validación

- Caso golden: `refcatastral=0382201VK4708C0001IZ` (Topete 33) → debe devolver `plantas_num_pages=7`.
- Si tras desplegar el caso golden falla, el problema es la URL real del Catastro y haría falta hacer un POST con ASP.NET ViewState (lo escalo entonces a "scraping con sesión").

## Detalles técnicos

- Catastro no tiene API REST pública para este PDF concreto; sí están las APIs de OVCServWeb (RCCOOR, DNPRC, etc.) que ya usamos para los datos alfanuméricos, pero la cartografía con distribución por plantas solo está en la Sede Electrónica detrás de `GeneraGraficoParcela.aspx`.
- El `del` (delegación, 2 dígitos) y `mun` (municipio, 3 dígitos) NO están en la refcat de 20 chars; salen del popup del mapa o se pueden derivar con una llamada extra a `OVCCallejero/OVCCallejeroCodigos.asmx/ConsultaMunicipioCodigos`.
- MuPDF WASM ya está en el edge — sin coste extra.
- Bucket `catastro` ya existe y es público; los assets se sirven directos sin signed URL.

## Pregunta antes de implementar

¿Lo lanzo en **modo greedy** (refresca los 74 de tu cartera nada más desplegar, sin esperar tu click) o prefieres tener primero el botón manual y validar el caso Topete antes de procesar los 73 restantes?

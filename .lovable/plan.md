## Fix descarga PDF + diagnóstico SVG en `fetch-catastro-data`

### Problema actual
Job `44eb03bc...` en fase catastro: 12/74 procesados, **12 con lat/lon ✅**, pero **0 PDF y 0 SVG**.

Logs confirman:
- `se descarta PDF genérico de consulta descriptiva` → el guard `isKnownGenericCatastroPdf` está tirando los PDFs correctos
- `plano svg: no <svg> in response` → OVC ya no devuelve SVG inline en `GeneraGraficoParcela.aspx`

### Cambios en `supabase/functions/fetch-catastro-data/index.ts`

1. **Eliminar el guard `isKnownGenericCatastroPdf`** (líneas ~207-254). Los PDFs de `SECImprimirCroquisYDatos` y `SECImprimirDatos` son los oficiales con croquis + datos; subirlos a storage y rasterizarlos como hasta ahora.

2. **Loggear los primeros 500 chars** de la respuesta de `GeneraGraficoParcela.aspx` cuando no contenga `<svg>`, para diagnosticar qué devuelve ahora OVC (HTML con imagen embebida, redirect, etc.). Solo logging — el fix del SVG vendrá en una segunda iteración cuando sepamos el formato real.

### Despliegue y continuación

3. **Deploy** de `fetch-catastro-data` (job actual sigue corriendo; los ~62 restantes se beneficiarán del fix de PDF inmediatamente).

4. **Al terminar el job**, relanzar los 12 primeros con `force:true` desde el orquestador para completar su PDF (el SVG depende del análisis del log nuevo).

### Verificación post-batch
```sql
SELECT 
  COUNT(*) FILTER (WHERE lat IS NOT NULL) AS con_coords,
  COUNT(*) FILTER (WHERE plantas_pdf_url IS NOT NULL) AS con_pdf,
  COUNT(*) FILTER (WHERE plano_url IS NOT NULL) AS con_svg
FROM catastro_data cd
JOIN buildings b ON b.id = cd.building_id
WHERE b.cartera_demo_seed = true;
```
Esperado: con_coords=74, con_pdf cerca de 74. con_svg se atacará después con los logs nuevos.

### Fuera de alcance
- Fix definitivo del SVG (requiere ver respuesta real de OVC primero)
- Cambios en `auto-process-cartera-demo`, `fetch-google-imagery`, dashboard `/admin`

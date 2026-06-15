## Plan: Verificar integración Browserless

El secreto `BROWSER_WSS_URL` ya está actualizado con la URL completa:
`wss://production-sfo.browserless.io/stealth/bql?token=...`

### Pasos
1. Invocar la edge function `browser-test` para confirmar que conecta correctamente a Browserless (devuelve versión del navegador y título de una página de prueba).
2. Si la conexión es OK, ejecutar una prueba real del flujo de enriquecimiento (`enrichment-agent` o el scraper de nota simple) con la dirección **Calle Ambros 28** para validar que Puppeteer navega y extrae datos.
3. Revisar logs de la edge function en caso de error y ajustar (timeouts, selectores, headers).

### Resultado esperado
- `browser-test` responde 200 con `{ ok: true, version, title }`.
- El flujo de alta de nuevo edificio puede usar Browserless sin errores de "Invalid URL".

¿Procedo a ejecutar la prueba?
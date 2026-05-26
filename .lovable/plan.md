
# Descargar el plano correcto: FXCC (croquis por plantas)

## El problema

Lo que el sistema ha estado guardando como `plantas_pdf` **no es** el plano de distribución por plantas. Es la **"Consulta Descriptiva y Gráfica"** (2 páginas: ficha del bien inmueble + croquis general de la parcela). Es el "plano general" que ves ahora.

El plano que has adjuntado (`FXCC_2658209VK4725H.pdf`, 8 páginas) es otro documento totalmente distinto del Catastro: el **FXCC – Croquis por plantas**, que muestra:
- PLANTA GENERAL con toda la huella
- Una página por cada planta (sótano, baja, I, II, III, IV…) con las subparcelas, usos (V.A.2, V.B.2, COM.TA…) y superficies en m²

Es exactamente la información que necesita la IA para sacar plantas elevables, distribución, esquinas, comunes, etc.

## La complicación

Verificado contra la Sede del Catastro: el endpoint del FXCC existe

```
https://www1.sedecatastro.gob.es/Cartografia/ImprimirPDFCroquisParcela.aspx
  ?del=<cp>&mun=<cmc>&refcat=<refcat14>
```

pero **está protegido por reCAPTCHA de Google** desde hace ya un tiempo. El botón en la web abre un aviso que dice literalmente: "La descarga de esos productos se realiza desde el visor cartográfico" y va a través de `CaptchaGoogleFXCC`. He probado con sesión + cookies + referer del visor y el endpoint devuelve `200 / text/html / 0 bytes` — no entrega el PDF sin resolver captcha.

Por eso lo que tenemos guardado en storage para los 74 edificios es la consulta descriptiva (sin per-planta), no el FXCC.

## Plan propuesto

### 1. Integrar un servicio anti-captcha
Añadir secret `TWOCAPTCHA_API_KEY` (2Captcha — el más barato y fiable para reCAPTCHA v2/v3, ~$2.99 por 1000 resoluciones). Para 74 edificios = ~$0.22 la primera tanda.

### 2. Nueva función `fetch-catastro-fxcc`
Aislada del scraper actual (que sigue valiendo para la consulta descriptiva). Flujo:

1. Recibe `refcat14` (los 14 primeros) y opcionalmente `cp`/`cmc`; si faltan, los obtiene de `Consulta_DNPRC` (ya lo hacemos).
2. Abre `mapaC.aspx?refcat=<refcat14>` para iniciar sesión + obtener el `sitekey` del reCAPTCHA.
3. Llama a 2Captcha con el sitekey y la URL → recibe `g-recaptcha-response` token (~20-40 s).
4. Hace POST/GET al endpoint `ImprimirPDFCroquisParcela.aspx` con el token en la cookie/cabecera que espere el servidor.
5. Guarda el PDF en storage como `<refcat14>_fxcc.pdf` (nombre distinto al actual para no pisar nada).
6. Rasteriza páginas a PNG con MuPDF.
7. Persiste en `catastro_data`: `fxcc_pdf_url`, `fxcc_pages_urls[]`, `fxcc_num_pages`.

### 3. Migración de DB
Añadir columnas a `catastro_data`:
- `fxcc_pdf_url text`
- `fxcc_pages_urls text[]`
- `fxcc_num_pages int`
- `fxcc_disponible boolean default false`

Las columnas `plantas_*` actuales se mantienen para no romper, pero se renombrarán internamente en el UI como "Consulta descriptiva".

### 4. UI — Ficha del edificio
`AnalisisPlanoCatastralCard.tsx`:
- Si hay `fxcc_pages_urls` → mostrar éstas como "Distribución por plantas" (es lo que la IA debe analizar).
- Si solo hay `plantas_pages_urls` → mostrarlas como "Consulta descriptiva" (info general).
- Permitir **subir manualmente** el FXCC desde la ficha (botón "Subir plano FXCC") por si el captcha falla.

### 5. IA — `analyze-building-vision`
Cambiar la entrada de imágenes: priorizar `fxcc_pages_urls` cuando exista (es el plano que sirve). El prompt actual ya está orientado a leer plantas, esquina, doble escalera, etc. — funciona mejor con las páginas del FXCC.

### 6. Relanzar
- Job `fxcc-batch` sobre los 74 edificios → bajar FXCC.
- Luego `analyze-building-vision` (forzado) → nuevo análisis IA con el plano correcto.
- `compute_score` recalcula avisos automáticamente vía trigger.

### Subir el de Diaz Porlier 47 ahora mismo
Como ya tienes el FXCC en mano para `2658209VK4725H`, lo subo directamente a storage como `2658209VK4725H_fxcc.pdf`, lo registro en `catastro_data` y lanzo el análisis IA solo de este edificio para validar la cadena end-to-end **antes** de gastar captchas con los 74.

## Lo que necesito confirmar

1. **¿Activamos 2Captcha?** Es la única vía automática viable. Alternativa: que tú (o el equipo) suba el FXCC manualmente desde la ficha — viable para 74 edificios si lo hacéis una vez.
2. **Validación con Diaz Porlier 47**: ¿OK que empiece subiendo tu PDF, registrándolo y relanzando solo la IA de este edificio para ver que el flujo IA→score funciona con el plano correcto, antes de tocar nada de captcha?

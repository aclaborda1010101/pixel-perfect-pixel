## Problema

El backfill de Deepgram avanza a tirones (~9 calls/hora). La función procesa 50 calls **en serie** dentro de un mismo invoke; el HTTP request timeout corta la ejecución antes de terminar el batch, la chain se rompe y hay que esperar a que el cron diario lo dispare otra vez. Con 1,848 pendientes a este ritmo serían ~8 días.

## Causa raíz

En `transcribe_call/index.ts` el bucle `for (const row of rows)` espera cada `transcribeOne` (descarga HubSpot + Deepgram + update DB) secuencialmente. Una call de 5min puede tardar 30-60s. 50 calls × media de ~10s = ~8min de wall time → timeout del edge gateway.

## Solución: procesamiento paralelo + respuesta inmediata

### Cambios en `supabase/functions/transcribe_call/index.ts`

1. **Concurrencia controlada (pool de 15 workers paralelos)**
   - Reemplazar el `for` serial por un pool: 15 calls procesándose en paralelo a la vez.
   - Deepgram soporta ~100 concurrentes y HubSpot gateway aguanta de sobra; 15 es conservador.
   - Tiempo de batch: pasa de ~8min a ~30-60s.

2. **Reducir `MAX_PER_RUN` de 50 → 30**
   - Batch más pequeño + paralelo = termina en <60s con margen, la chain HTTP se cierra limpiamente.

3. **Respuesta temprana con `EdgeRuntime.waitUntil`** (modo batch)
   - Devolver `202 accepted` inmediatamente y procesar en background.
   - Así el timeout HTTP del invocador (cron / curl) ya no puede cortar el procesamiento.
   - El re-chain también se dispara en background.

4. **Quitar el `SLEEP_BETWEEN_MS`** (era para Groq RPM, ya no aplica con Deepgram + paralelismo).

5. **Logging por batch** (`console.log` con processed/ok/fail/elapsed) para tener visibilidad sin depender de HTTP response.

### Lo que **no cambia**

- Lógica de transcripción, diarización Comercial/Cliente, speaker_stats, refresh URL HubSpot.
- Schema de DB, agent_runs, hubspot_sync_state.
- Cron `transcribe-daily` (sigue disparando una vez al día como red de seguridad).
- Modo single (`{call_id}`) sigue síncrono.

### ETA esperado tras el cambio

- 1,848 pendientes ÷ 15 paralelo × ~8s media = **~17 minutos** total.
- Para ser realistas con varianza y re-chains: **~30-45 minutos**.

### Disparo

Tras desplegar, hago un POST a `/transcribe_call` con `{chain:true}` para arrancar la cadena.

### Riesgos / mitigación

- **Rate limit Deepgram**: el reintento con backoff exponencial ya está; con 15 paralelos estamos muy por debajo del límite.
- **Memoria edge function**: cada call carga el MP3 en RAM. 15 × ~5MB = 75MB, dentro del límite (256MB).
- **Updates DB concurrentes**: cada call hace UPDATE sobre su propio `id`, sin contención.

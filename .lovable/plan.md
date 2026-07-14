## Contexto y diagnóstico

El bot está **funcionando como está configurado**, no hay bug:

- `wa_bot_config`: `is_active=true`, `active_hours = { from:"09:00", to:"20:30", days:[1..5], tz:"Europe/Madrid" }`.
- En `wa_ai_reply/index.ts` (l. 512–534), fuera de horario se hace **silencio total**: el mensaje entrante se registra, el job pasa a `status='deferred'` y **no** se envía ni el `off_hours_message`.
- Cuando llegan las 09:00 no se retoma nada: el bot sólo vuelve a contestar si el cliente escribe de nuevo dentro del horario. Por eso los mensajes de las 7:44 quedan sin respuesta indefinidamente si el cliente no reescribe.

Decisión tomada: **mantener 09:00–20:30 L–V** y **retomar automáticamente** los jobs `deferred` en cuanto se abra la ventana.

## Cambios

### 1) Nueva edge function `wa_replay_deferred`

Ruta: `supabase/functions/wa_replay_deferred/index.ts`.

Responsabilidad: al abrir el horario, disparar `wa_ai_reply` una sola vez por conversación con jobs `deferred`.

Lógica:
1. Leer `wa_bot_config`. Si `is_active=false`, salir.
2. Calcular `madridNow` (misma helper que `wa_ai_reply`, `Europe/Madrid`). Si NO estamos dentro de `active_hours` (día laborable y `now ∈ [from, to)`), salir sin hacer nada.
3. Guardia anti-doble ejecución diaria: leer/escribir una fila en `app_settings` con `key='wa_replay_deferred_last'`, `value = { date: 'YYYY-MM-DD (Europe/Madrid)' }`. Si el `date` ya coincide con hoy, salir. Si no, escribirlo antes de continuar (evita duplicados si el cron ejecuta varias veces por DST/solape).
4. Seleccionar los `conversation_id` DISTINTOS con al menos un `wa_ai_jobs.status='deferred'`.
5. Para cada conversación:
   - `UPDATE wa_ai_jobs SET status='pending', updated_at=now() WHERE conversation_id=$1 AND status='deferred'`.
   - Llamar a `wa_ai_reply` con `{ conversation_id }` (fire-and-forget vía `fetch` al endpoint `/functions/v1/wa_ai_reply` con service-role key). No esperamos: el propio `wa_ai_reply` ya trae debounce, mutex atómico (`pending→running`) y anti-duplicado, así que reactivarlo por conversación es seguro. Añadir pequeño jitter entre llamadas (200–400 ms) para no saturar Evolution.
6. Devolver `{ ok:true, conversations_relanzadas: N }`.

Notas:
- El `verify_jwt` queda por defecto (Lovable-managed).
- Usa CORS estándar y validación mínima (no recibe input del cliente).
- Registra un log de resumen (`console.log`) por ejecución.

### 2) Cron

Se programa vía SQL (pg_cron + pg_net, ya presentes en el proyecto por otros trabajos). Se ejecuta **cada 5 minutos entre 06:00 y 10:00 UTC de lunes a viernes**, cubriendo las dos posibles conversiones horarias:

- Verano (CEST, UTC+2): 09:00 Madrid = 07:00 UTC.
- Invierno (CET, UTC+1): 09:00 Madrid = 08:00 UTC.

La ventana amplia + la guarda anti-doble-ejecución dentro de la función garantiza que se dispare exactamente una vez el primer minuto en el que Madrid entra en la franja activa, aunque cambie el DST. Y si además el cron llegara a fallar un tick, el siguiente reintenta.

Se insertará vía `supabase--insert` (no migración, contiene URL y anon key del proyecto) siguiendo el patrón:

```sql
select cron.schedule(
  'wa-replay-deferred-open',
  '*/5 6-9 * * 1-5',
  $$
  select net.http_post(
    url:='https://<project-ref>.supabase.co/functions/v1/wa_replay_deferred',
    headers:='{"Content-Type":"application/json","apikey":"<anon-key>"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
```

Antes de ese `cron.schedule` se ejecuta `create extension if not exists pg_cron; create extension if not exists pg_net;` si no estuvieran ya, y se borra cualquier job previo con el mismo nombre (`cron.unschedule('wa-replay-deferred-open')` con guard).

### 3) `app_settings` — nueva key

- key: `wa_replay_deferred_last`
- value (jsonb): `{ "date": "YYYY-MM-DD" }` (fecha Europe/Madrid del último replay ejecutado)

No hace falta migración de esquema: `app_settings` ya existe. Sólo se hace un `UPSERT` desde la función.

## Qué NO se toca

- No se cambia `active_hours` (queda 09:00–20:30 L–V).
- No se toca `wa_ai_reply` ni `reply_guard.mjs` ni el resto del pipeline (webhooks, envío, kill switch, mutex, debounce).
- No se envía `off_hours_message`: los mensajes de fuera de horario siguen en silencio; sólo se responden al abrir.

## Verificación tras despliegue

1. Comprobar en `wa_ai_jobs` que existen filas `status='deferred'` (ej. el caso de las 7:44 de hoy).
2. Invocar manualmente `wa_replay_deferred` con `supabase--curl_edge_functions` (dentro del horario) y verificar:
   - Respuesta `ok:true, conversations_relanzadas: N`.
   - Los jobs pasan de `deferred` → `pending` → `running`/`done`.
   - Se envía respuesta al contacto en WhatsApp.
   - Segunda invocación seguida ⇒ `conversations_relanzadas: 0` (guarda diaria funciona).
3. Confirmar el cron con `select * from cron.job where jobname='wa-replay-deferred-open'`.

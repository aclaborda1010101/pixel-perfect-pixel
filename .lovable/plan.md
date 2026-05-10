## Diagnóstico cruce calls ↔ hubspot_calls (sobre 3.879 filas)

```
total                       3.879
├─ from_hubspot              3.849  (resumen LIKE '[hs:...]')
└─ native                       30

rec + body  (analizables ya)   1.437
body only   (sin grabación)    1.109   ← analizables igualmente
rec only    (sin body)           454   ← grabadas SIN texto, RECUPERABLES
neither     (vacías)             879   ← irrecuperables

analizables actuales (transcripcion ≠ ∅) = 1.437 + 1.109 = 2.546
```

### Lectura del 2.897 esperado vs 2.546 real

- Tu hipótesis "grabadas en HubSpot ≈ 2.897" no encaja con los datos: con `recording_url` solo hay **1.891** (1.437+454).
- El gap real son **454 calls grabadas pero sin `hs_call_body`**. HubSpot pone la transcripción auto-generada en otra property que no pulleamos.
- Las 879 "neither" son engagements de llamada sin body ni grabación (notas escuetas tipo "no contesta", llamadas perdidas registradas a mano). Son irrecuperables.

### Properties candidatas a añadir al pull (HubSpot CRM Calls)

Pulleamos hoy:
```
hs_call_title, hs_call_body, hs_call_status, hs_call_direction,
hs_call_disposition, hs_call_duration, hs_call_recording_url,
hs_call_to_number, hs_call_from_number, hs_timestamp,
hs_createdate, hs_lastmodifieddate
```

Faltan (todas read-only, gratis pullear):
- **`hs_call_transcription`** o **`hs_call_recording_transcript`** — texto plano de la transcripción auto-generada por HubSpot. Esta es la que nos interesa.
- `hs_call_summary` / `hs_call_ai_summary` — resumen IA de HubSpot (bonus).
- `hs_call_video_recording_url` — para Zoom/Teams.

> Los nombres internos varían por portal (algunos llevan sufijo `__c` o están en namespace custom). Lo seguro es probar con un `GET /crm/v3/properties/calls` primero para ver qué tiene este portal y elegir el internal name correcto.

### Plan

1. **Discovery** (1 query a HubSpot, read-only): GET `/crm/v3/properties/calls` → filtrar por nombre que contenga `transcript|summary` → te reporto los internal names exactos disponibles en tu portal.
2. **Añadir** esas properties al array `calls:[...]` en `hubspot_sync_engagements/index.ts` y a las columnas equivalentes en `hubspot_calls` (nuevas columnas `hs_call_transcription text`, `hs_call_summary text` vía migración).
3. **Re-pull** `hubspot_sync_engagements` con `force_refresh=true` solo para calls — chunks normales hasta cursor vacío.
4. **Modificar `promote_calls`**: cuando `hs_call_body` esté vacío pero `hs_call_transcription` exista, usar la transcripción como `transcripcion` en la tabla operativa. Idempotente: UPDATE de las 454 filas existentes.
5. Reporte: nuevo `analizables` final (esperado entre 2.546 y 3.000).
6. **Después**, aplicar UI:
   - `/llamadas`: chip "Solo analizables" (default ON) | "Todas" — filtra por `transcripcion ≠ ∅` en cliente. Tarjeta KPI muestra `analizables` como valor principal y `total` como subtítulo.
   - Dashboard: tile "Llamadas" muestra `analizables`, total como subtítulo. Añadimos un 2º count en el `Promise.all`.
   - Sin DELETE, sin tocar HubSpot, idempotente.

## Lo que necesito de ti

¿Lanzo el discovery de properties (paso 1) para confirmar los internal names exactos antes de migrar/re-pullear? Si sí, sigo encadenando 1→6 sin pausa.

Alternativa rápida: si prefieres no esperar al re-pull, aplico solo la UI ahora con 2.546 como número correcto (las 454 quedan como deuda técnica documentada). Tú decides.
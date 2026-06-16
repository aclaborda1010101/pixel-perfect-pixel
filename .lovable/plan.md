## Qué pasa

Tienes razón: Settings se ha convertido en un panel de control de fábrica con ~10 tarjetas admin, cada una con 4-12 botones de "lanzar". Eso no es una pantalla de usuario, es una consola de operaciones mía. Mezcla tres cosas distintas:

1. **Cosas de usuario** (idioma, tema, cuenta, equipo, HubSpot connect, roles, asignaciones de edificios).
2. **Configuración real** (sub‑zonas, playbook, knowledge base, enrichment config, parámetros de IA).
3. **Operaciones internas** (lanzar reprocesos, recontar ventanas, transcribir llamadas, detectar DH, recalcular cuotas, demos end‑to‑end, batches de catastro/imagery/vision, etc.) — esto NO debería verlo nadie, ni siquiera tú como admin.

## Propuesta

### Paso 1 — Yo ejecuto ahora lo que está pendiente
Sin tocar UI, lanzo los dos jobs nuevos contra la BD actual y te devuelvo números:
- `detect_division_horizontal` (max 500) → cuántos edificios pasan a DH=true.
- `recompute_building_owner_cuotas` (max 500) → cuántas cuotas se anulan (DH), cuántas se recalculan, cuántas quedan marcadas `cuota_inconsistente`.
- Re‑validación: los casos absurdos previos (P.º Martínez Campos 23 = 25.200%, Zurbano 57 = 400%) deben quedar saneados.

Solo lectura para ti: te paso el JSON resumen y un sample de 5 edificios antes/después.

### Paso 2 — Simplificar Settings (lo que vas a ver)
Settings se queda en **5 tarjetas** y nada más:

```
┌─────────────────────┬─────────────────────┐
│ Cuenta              │ Equipo              │
├─────────────────────┼─────────────────────┤
│ Idioma              │ Apariencia          │
├─────────────────────┴─────────────────────┤
│ HubSpot (estado conexión + última sync)   │
└───────────────────────────────────────────┘
```

Eso es todo. Sin botones de "lanzar nada".

### Paso 3 — Mover lo admin de configuración a su sitio
- **Roles de usuario** y **Asignaciones de edificios** → nueva ruta `/admin/equipo` (un solo sitio, no dos tarjetas).
- **Sub‑zonas**, **Calles comerciales** → `/admin/zonas`.
- **Playbook**, **Knowledge base**, **Aprendizaje IA**, **Enrichment config** → `/admin/ia` (una pantalla con tabs).

Acceso solo desde el avatar arriba‑derecha → "Admin" (solo visible si `isAdmin`). Settings deja de ser la papelera de todo.

### Paso 4 — Esconder por completo "Jobs manuales" y "Análisis IA & Catastro"
Estas son MIS herramientas, no tuyas. Se mueven a `/admin/_ops` (ruta no enlazada en ningún menú; existe para que yo la abra cuando me pides "lanza X"). En su lugar, en cualquier sitio donde antes había un botón de "lanzar reproceso", aparece una nota:

> "Si necesitas reprocesar esta cartera, pídemelo en el chat."

Yo lo lanzo desde el sandbox y te devuelvo resultado. Cero botones de IA al alcance del cursor (= cero gasto accidental, cero ansiedad de pantalla).

### Paso 5 — "Continuar sincronización HubSpot"
Eso debe ser **automático** (cron ya existente) o como mucho un único botón "Sincronizar ahora" en la tarjeta HubSpot. Los 6-8 botones distintos de sync (edificios, owners, calls, emails, notes, tasks, meetings…) se colapsan en uno solo que hace todo en orden.

## Lo que NO voy a hacer
- No borro las edge functions ni los paneles, solo los desmonto de Settings y los muevo a `/admin/_ops` (para que tú no los veas pero yo los pueda invocar).
- No quito el gate `isAdmin`.
- No toco lógica de negocio: jobs, scoring, DH, cuotas, todo sigue funcionando igual.

## Pregunta única antes de empezar
¿Empiezo por **Paso 1** (ejecuto DH + recálculo cuotas ahora y te paso números) y luego en el mismo turno hago Pasos 2-4 (simplificar Settings + mover admin)? ¿O prefieres ver primero los números y decides después si simplifico Settings?

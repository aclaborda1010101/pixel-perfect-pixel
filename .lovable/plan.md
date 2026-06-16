## Plan: ejecutar recálculo + simplificar Settings

### Paso 1 — Ejecutar `recompute_building_owner_cuotas` (sandbox)
Sin tocar UI. Lanzo la función contra los ~571 edificios con owners y devuelvo:
- Totales: `dh` (cuotas → NULL), `no_dh` (derivadas de nota), `inconsistentes` (Σ≠100±1).
- Sample antes/después de los 5 edificios que tenían Σ>1000% (P.º Mtnez Campos 60, Zurbano 57, etc.).
- Validación: los 32 edificios con Σ>105% deben quedar saneados o marcados `cuota_inconsistente`.

### Paso 2 — Simplificar `src/pages/Settings.tsx`
Settings se queda con **5 tarjetas** y nada más:
- Cuenta · Equipo · HubSpot (estado + un único botón "Sincronizar ahora") · Idioma · Apariencia.

Quito de Settings los imports y render de: `RolesPanel`, `BuildingAssignmentsPanel`, `AnalisisIAPanel`, `SubZonasPanel`, `AprendizajePanel`, `KnowledgeBasePanel`, `PlaybookPanel`, `EnrichmentConfigPanel`, `JobsManualPanel`.

Los componentes **NO se borran**, solo dejan de renderizarse en Settings.

### Paso 3 — Mover admin a rutas `/admin/*`
Nuevas páginas (cada una monta los paneles existentes, sin reescribir lógica):
- `/admin/equipo` → `RolesPanel` + `BuildingAssignmentsPanel`.
- `/admin/zonas` → `SubZonasPanel`.
- `/admin/ia` → tabs con `PlaybookPanel`, `KnowledgeBasePanel`, `AprendizajePanel`, `EnrichmentConfigPanel`, `AnalisisIAPanel`.
- `/admin/_ops` → `JobsManualPanel` (ruta sin enlace en menú; existe para que yo la abra cuando me pidas un job).

Todas con gate `isAdmin` vía `ProtectedRoute`. Registradas en `src/App.tsx`.

### Paso 4 — Acceso desde el avatar
En `Topbar` (avatar arriba-derecha), si `isAdmin` añado un menú "Admin" con enlaces a `/admin/equipo`, `/admin/zonas`, `/admin/ia`. `/admin/_ops` queda oculto.

### Paso 5 — HubSpot: un solo botón
En `HubspotPanel` reemplazo los múltiples botones de sync por uno: "Sincronizar ahora" que invoca en orden las funciones existentes (owners → companies → contacts → deals → engagements → calls → notes → tasks → meetings). Sin cambios en las edge functions.

### Lo que NO toco
- Edge functions (lógica intacta).
- Gate `isAdmin`.
- Lógica de negocio (DH, cuotas, scoring, jobs).
- Los paneles admin en sí (sólo cambian de sitio).

### Detalles técnicos
- Archivos nuevos: `src/pages/admin/Equipo.tsx`, `Zonas.tsx`, `IA.tsx`, `Ops.tsx`.
- Editados: `src/pages/Settings.tsx`, `src/App.tsx`, `src/components/layout/Topbar.tsx`, `src/components/settings/HubspotPanel.tsx`.
- Sin migraciones de BD.

¿Procedo?

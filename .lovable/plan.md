
# Sistema de roles + Dashboard Comercial

Construcción por fases. Aprueba el plan y empezamos por la Fase 1 (roles + ruteo). Cada fase deja la app funcionando.

## Fase 1 · Roles y ruteo por rol

**Backend**
- Extender enum `app_role` con: `captacion`, `comercial_zona`, `prevalificacion` (ya existen `admin` y `viewer`).
- Tabla nueva `building_assignments (building_id, user_id, role, assigned_at)` con RLS y policies (admin gestiona, comercial ve los suyos).
- Función `current_user_role()` → devuelve el rol de mayor prioridad del usuario actual.
- Mantener `has_role()` ya existente.

**Frontend**
- Hook `useCurrentRole()` cacheado.
- `AppLayout` y `AppSidebar` filtran items según rol:
  - `comercial_zona`: Inicio (→ `/comercial`), Edificios, Llamadas, Productividad, Asistente. Oculta Inversores, Settings avanzado, sync HubSpot, Investors, Coach.
  - `admin`: todo (estado actual).
  - `captacion`, `prevalificacion`: placeholder mismo menú que comercial por ahora.
- Redirección post-login: admin → `/`, comercial_zona → `/comercial`.

**Settings → "Roles de usuario"** (solo admin)
- Tabla con todos los users (`profiles`), select del rol, botón guardar. Usa `user_roles`.

## Fase 2 · Dashboard Comercial (`/comercial`)

Página nueva `src/pages/comercial/Dashboard.tsx`, mismo design system.

**Bloques**
1. Saludo: "Buenos días, {first_name}" + fecha + clima de cartera (1 frase con cifra clave).
2. KPIs (4 tarjetas):
   - Llamadas pendientes hoy (next_actions tipo llamada, vencimiento ≤ hoy, owner asignado a mí).
   - Edificios asignados activos (count `building_assignments` user=yo).
   - Propietarios sin contactar (building_owners de mis edificios donde owner.last_contact IS NULL).
   - Tasa contacto semanal (% propietarios contactados / total mis edificios, últimos 7 días).
3. **Mi agenda del día**: lista priorizada de llamadas pendientes ordenadas por `building_score` desc (ver Fase 5). Cada fila: hora sugerida, propietario, edificio, score, botones "Preparar" / "Marcar resultado".
4. **Edificios con propietarios pendientes**: cards con dirección, score, "X de Y contactados", barra % propiedad acumulada contactada, botón "Ver detalle" → `/comercial/edificios/:id`.

## Fase 3 · Vista Edificio Comercial (`/comercial/edificios/:id`)

- Header: dirección + ciudad + score grande + badge división horizontal.
- **Datos catastrales**: m², viviendas, ratio m²/viv, div. horizontal, año, ref. catastral (de `buildings.metadatos`).
- **Scoring · desglose visual**: barras por componente (viviendas, m², ratio, nº propietarios, div. horizontal) con peso y aportación.
- **Google Maps embed** (iframe sin API key con `q=` dirección).
- **Tabla de propietarios** (todos los `building_owners`):
  - Columnas: nombre, % propiedad, estado (badge color), teléfonos, última interacción, sub-score.
  - Filas sin contacto resaltadas en rojo suave.
  - Sort por % propiedad / estado / última interacción.
  - Click fila → drawer detalle propietario + botón "Preparar llamada".

## Fase 4 · Asistencia IA pre/post llamada

**Pre-llamada** (`/comercial/preparar/:owner_id?building=...`)
- Reusa edge function existente `agent_pre_call_brief` (ya implementada).
- UI muestra: resumen edificio + oportunidad, historial interacciones (hubspot_calls + hubspot_notes + whatsapp), datos propietario (% prop., cargas/embargos de nota simple), 3 sugerencias de approach, 5 puntos clave.

**Post-llamada** (drawer rápido al cerrar la llamada)
- Form: outcome (interesado/no interesa/volver/no contesta), notas, duración.
- Al enviar: insert en `calls` + `next_actions` (auto-seguimiento según outcome) + invoca edge `analyze_call` (ya existe) para Quality Score, oportunidades perdidas y sugerencia próximos pasos.

## Fase 5 · Scoring (vistas SQL)

Crear vistas materializables (vista normal por simplicidad):

- `v_building_score`:
  ```
  weight(viviendas)*norm(num_viviendas)
  + weight(m2_total)*norm(m2_total)
  + weight(ratio)*norm_invert(m2/viv)  -- menor = mejor
  + weight(nprops)*norm(num_propietarios)
  + bonus si NOT division_horizontal
  ```
  Datos: `buildings` + agregados `building_owners`. Pesos fijos (configurables luego en `org_settings`).

- `v_owner_score`:
  ```
  weight(pct)*pct_propiedad
  + weight(edad)*norm(edad)
  + weight(cargas)*(1 - cargas_normalizadas)
  + weight(contactos_prev)*norm(num_contactos)
  + weight(interes)*encoded_interes
  ```

Default coverage tolerante a NULLs.

## Fase 6 · Productividad personal (`/comercial/productividad`)

Reusa `Productividad` actual pero filtrado por `owner_id = me` y añade:
- Cards: llamadas día/semana/mes, tasa contacto efectivo.
- Heat map horarios óptimos (reusa `v_dashboard_call_heatmap` filtrado).
- Edificios trabajados vs pendientes (subset de mis asignados).
- Ranking conversión por tipo edificio (agrupar por bucket de viviendas: pequeño <10, mediano 10-30, grande >30).
- Gráfico evolución temporal (Recharts línea, últimos 90 días).

## Detalles técnicos

```text
src/
  pages/
    comercial/
      Dashboard.tsx
      EdificioDetalle.tsx
      Productividad.tsx
      PrepararLlamada.tsx
    settings/
      RolesPanel.tsx   (sección dentro de Settings.tsx)
  hooks/
    useCurrentRole.ts
    useBuildingScore.ts
  components/comercial/
    KpiTile.tsx
    AgendaList.tsx
    EdificioCard.tsx
    OwnerRow.tsx
    PostCallDrawer.tsx
supabase/migrations/
  - extend app_role enum
  - building_assignments + RLS
  - v_building_score, v_owner_score
  - current_user_role() function
```

Edge functions: ninguna nueva (reusa `agent_pre_call_brief`, `analyze_call`, `compute_matches`).

## Preguntas para arrancar

1. **Asignación de edificios a comerciales**: ¿la haces manual desde Settings (admin asigna), o autoasignación por distrito/ciudad? (asumo manual por defecto).
2. **"Propietario contactado"**: ¿lo defino como "tiene al menos 1 `hubspot_calls` o `calls`" o necesitas un flag explícito `last_contact_at` en `owners`? (asumo lo primero, sin nueva columna).
3. **Pesos de scoring**: ¿fijos en código por ahora (p.ej. viviendas 30%, m² 20%, ratio 20%, n_prop 20%, no-DH 10%) o editables en Settings desde el principio? (asumo fijos en código).
4. **Jesús ya tiene cuenta**: ¿le asigno el rol `comercial_zona` automáticamente al aprobar la migración o lo haces tú desde Settings? (asumo manual desde Settings tras Fase 1).

Confirma estas 4 y arranco por Fase 1 (roles + ruteo + Settings). El resto cae detrás en orden.

## Problema detectado en /activos/:id (mobile 390px)

En el screenshot se ven varios fallos típicos en `AssetDetail.tsx`, que se repiten en `OwnerDetail.tsx`, `BuildingDetail.tsx` y `CallAnalysis.tsx`:

1. **Crumbs desbordan**: la breadcrumb "ACTIVOS › EDIFICIO › ACTIVO DEMO #1" no hace wrap y empuja el layout.
2. **TabsList desborda en horizontal** (4–8 pestañas con `text-xs` y sin scroll). Genera overflow-x lateral.
3. **PageHeader actions** (badges/botones) compiten con el título largo y se cortan.
4. **Aside/timeline lateral** declarado como `lg:grid-cols-[1fr_300px]`, en mobile aparece debajo correctamente, pero los KPIs internos `sm:grid-cols-3 / sm:grid-cols-4 / lg:grid-cols-5` saltan demasiado pronto y se aprietan en tablets pequeños.
5. **BuildingDetail**: tabla `<Table>` de unidades + Tabs de 7 pestañas + grid de KPIs de 5 columnas → desborda fuerte en mobile.
6. **CallAnalysis**: subtitle con muchos elementos en `flex` sin `flex-wrap` correcto a tamaños extremos; layout `lg:grid-cols-2` ya stackea, pero el `<pre>` de transcripción tiene `overflow-auto` solo vertical y puede empujar horizontalmente.

## Cambios a aplicar

Sin tocar rutas, queries Supabase, hooks de datos, `.env` ni i18n.

### 1. `src/pages/AssetDetail.tsx`
- Wrapper raíz: añadir `min-w-0` y `w-full` al `div.space-y-6` para que no fuerce ancho.
- KPIs: cambiar `grid gap-4 sm:grid-cols-3` → `grid grid-cols-1 gap-3 sm:grid-cols-3` y reducir padding `p-5` → `p-4 md:p-5`.
- TabsList: envolver en wrapper con scroll horizontal:
  ```tsx
  <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
    <TabsList className="w-max md:w-auto">…</TabsList>
  </div>
  ```
- Aside: añadir `min-w-0`. En mobile el grid `lg:grid-cols-[1fr_300px]` ya stackea; ok.
- Items con `flex items-center justify-between`: añadir `gap-3 min-w-0` y al `<div>` de texto `min-w-0 flex-1` con `truncate`.

### 2. `src/pages/OwnerDetail.tsx`
- Mismas correcciones que AssetDetail.
- KPIs: `grid grid-cols-2 gap-3 sm:grid-cols-4` (en lugar de `sm:grid-cols-4` directo).
- TabsList con 8 triggers → scroll horizontal con `-mx-4 px-4 overflow-x-auto`, `TabsList w-max`.
- PageHeader actions con badges → ya envuelto en `flex items-center gap-2`, añadir `flex-wrap`.

### 3. `src/pages/BuildingDetail.tsx`
- KPIs `md:grid-cols-3 lg:grid-cols-5` → `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` para evitar 1 columna apretada y dar respiro en mobile (2 cols).
- Chips eyebrow: ya `flex-wrap`, ok.
- TabsList (7 triggers) → scroll horizontal igual patrón.
- PageHeader actions (3 botones) → wrap a `flex flex-wrap`.
- Tabla `<Table>` de unidades: envolver en `<div className="overflow-x-auto">` para scroll horizontal nativo en mobile sin romper el layout.
- Lista de propietarios `bos.map`: el `<li>` con `flex items-center justify-between` y muchos badges + botón X → en mobile cambiar a `flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between`.
- Próximas acciones grid: `md:grid-cols-3` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`.

### 4. `src/pages/CallAnalysis.tsx`
- Wrapper raíz: `min-w-0 w-full`.
- PageHeader subtitle ya tiene `flex-wrap`, ok.
- TabsList (3 triggers) ya cabe; añadir igualmente patrón seguro `overflow-x-auto`.
- `<pre>` transcripción: añadir `break-words` y wrap container `min-w-0` para que `whitespace-pre-wrap` se aplique sin desbordar.
- Acciones por línea (`<li> flex items-start justify-between`): permitir `flex-col sm:flex-row` para que el botón "Guardar acción" no se aplaste contra el texto largo.

### 5. `src/components/common/Crumbs.tsx` (revisar)
- Asegurar `flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0` para que las migas hagan wrap en mobile y no fuercen overflow.

### 6. `src/components/common/PageHeader.tsx` (revisar)
- Asegurar que `actions` esté en un contenedor `flex flex-wrap` y que el bloque título use `min-w-0` con `break-words` en h1, para no empujar al sidebar.

### 7. Patrón reutilizable de Tabs scrollables
No se crea componente nuevo (para no aumentar superficie). Se aplica el wrapper inline en cada página afectada. El propio `TabsList` mantiene su tamaño natural (`w-max`) y se permite scroll horizontal solo dentro del wrapper.

## Diagrama de layout mobile final por detalle

```text
┌─────────────────────────────────┐
│ Crumbs (wrap)                   │
│ PageHeader                      │
│   eyebrow                       │
│   H1 (break-words)              │
│   subtitle                      │
│   actions (flex-wrap)           │
├─────────────────────────────────┤
│ KPIs grid-cols-1 / 2 cols       │
├─────────────────────────────────┤
│ Tabs ◀──── scroll-x ────▶       │
│ ┌─ contenido tab ─────────────┐ │
│ │ cards / listas con          │ │
│ │ items flex-col sm:flex-row  │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Aside Timeline (apilado abajo)  │
└─────────────────────────────────┘
```

## Lo que NO se toca

- Rutas en `App.tsx`.
- Queries Supabase ni hooks de datos.
- `.env`, i18n, traducciones.
- Lógica de estado, navegación o componentes funcionales.
- Auth / DEMO_MODE.

## Validación tras implementar

- `tsc --noEmit` verde.
- Visual check a 390px en `/activos/:id`, `/propietarios/:id`, `/edificios/:id`, `/llamadas/:id`: sin overflow-x, tabs scrolleables, KPIs respirando, listas legibles.
- Desktop ≥md mantiene exactamente el layout actual.

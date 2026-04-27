## Contexto

El HTML que has subido es un canvas tipo Figma con **18 artboards** ya diseñados, agrupados en 11 secciones, más una pantalla "Design system" con paleta y atoms. Cubre todo el panel Afflux y mapea casi 1:1 con tus rutas actuales (`Dashboard`, `Buildings`, `Assets`, `Owners`, `Investors`, `Calls`, `Matching`, `Cadences`, `Compliance`, `Settings`, wizards, login).

Este plan respeta tres reglas que ya marcaste:
- No tocar lógica, Supabase, rutas ni edge functions.
- No tocar `src/integrations/supabase/*` ni `.env`.
- Avanzar por fases pequeñas y revisables.

---

## Inventario extraído del HTML

**Paleta oficial (modo oscuro principal)**
- Fondo app: `#0A1422` (azul marino noche profundo)
- Brand / superficie marca: `#0E1B2C`
- Surface 1 / cards: `#152538`
- Surface 2 / hover, borders fuertes: `#1E3A5F`
- Borde sutil sobre oscuro: `rgba(255,255,255,0.06–0.10)`
- Foreground: `#EEF2F8` · muted: `#B6C0CE` · faint: `#6B7C95` / `#5A6B82`
- **Acento marca (champán/dorado): `#C9A961`** — el color clave que identifica Afflux
- Info: `#3D5A80` / `#4A6FA5` · Success: `#3F7D5C` (+ soft `#8FCAA8`)
- Warning: `#FFBA08` · Danger: `#E07856`

**Tipografía** (ya cargada en `index.html`, solo falta afinar uso)
- **Fraunces** (serif, opsz 9..144, w 400/600) → titulares editoriales del DS ("Sobrio. Notarial. Premium.")
- **Inter Tight** (400/500/600/700) → display + body
- **Geist Mono** (400/500) → eyebrows tipo `AFFLUX PROPERTY · DESIGN SYSTEM`, números, códigos de color, métricas

**Estética**: notarial, sobria, premium. Bordes finos, sombras muy planas, radios pequeños (2–6px en cards, no las 12–16px típicas de shadcn), tablas densas estilo Attio, separadores `1px solid border-faint`.

**18 artboards / 11 secciones del canvas**:
1. Design system · Tokens y atoms
2. Auth · Login dark, Login light, Recuperar contraseña
3. Dashboard
4. Cartera · Edificios + Building Detail (Serrano 85)
5. Cartera · Activos + Asset Detail
6. Cartera · Propietarios + Owner Detail
7. Cartera · Inversores
8. Operativo · Llamadas + Call Analysis (con waveform)
9. Pipeline · Cadencias (builder visual) + Matching (activos ↔ inversores)
10. Operaciones · Compliance + Wizard crear operación
11. Cuenta · Settings + 404

---

## Plan por fases

### FASE 1bis — Cerrar tokens (cierra lo que iniciaste)
Solo `src/index.css` y `tailwind.config.ts`. Sin tocar componentes.

- Añadir tokens que faltan en `:root` (modo oscuro como principal):
  - `--brand: 213 52% 11%` (#0E1B2C), `--surface-1: 213 44% 15%` (#152538), `--surface-2: 213 51% 25%` (#1E3A5F)
  - `--gold: 41 47% 59%` (#C9A961) y `--gold-soft` para hovers/fondos sutiles
  - `--ink-muted: 217 19% 76%` (#B6C0CE), `--ink-faint: 217 16% 50%` (#6B7C95)
  - Reescalar `--success`, `--warning`, `--info`, `--destructive` a los exactos del DS.
- Sombras "notariales" planas: `--shadow-xs/sm/md` con valores `0 1px 2px rgba(0,0,0,.25)` en oscuro, sin halos azulados.
- Radios: `--radius-sm: 2px`, `--radius: 6px`, `--radius-lg: 10px` (bajamos la calidez para encajar con el DS).
- Mapeos shadcn: `--background → 0A1422`, `--card → 152538`, `--popover → 0E1B2C`, `--border → blanco α 0.08`, `--ring → gold`.
- En `tailwind.config.ts`: añadir `colors.gold`, `colors.brand`, `colors.surface.{1,2}` y utilidades de tracking para la mono (`tracking-eyebrow: 0.18em`).
- Modo claro: definir variantes equivalentes (login claro existe en el HTML), pero **dark = default** del panel.

### FASE 2 — Atoms y patrones base (sin romper rutas)
Solo retoques visuales en `src/components/ui/*` y `src/components/common/*`. La API y los nombres de los componentes shadcn no cambian.

- `Button`: variant `gold` (CTA principal), `ghost` más sobrio, radios 6px.
- `Card`: borde 1px, sombra plana, header con eyebrow mono opcional.
- `Badge`: variants `info/success/warning/danger/gold` con backgrounds soft.
- `Table`: densificar (filas 36–40px), separadores `border-faint`, hover sutil, primera columna sticky preparada.
- `StatusBadge`, `PageHeader`, `Crumbs`, `EmptyState`: estilo notarial.
- Añadir 2 atoms nuevos en `src/components/common/`: `Eyebrow` (mono uppercase tracking ancho) y `MetricValue` (Geist Mono tabular-nums para KPIs).

### FASE 3 — Shell del panel
`AppLayout`, `AppSidebar`, `Topbar`. Sin cambiar rutas ni navegación.

- Sidebar oscuro `--brand`, ítems con icono + label, sección activa con barra dorada izquierda 2px y fondo `surface-1`.
- Logo "Afflux Property" arriba, eyebrow mono debajo.
- Topbar: search command (⌘K) prominente, breadcrumbs, avatar a la derecha, badge beta.
- Densidad y spacing del HTML (sidebar ~248px, topbar ~56px).

### FASE 4 — Dashboard + Cartera
- `Dashboard`: KPIs (mono tabular), próximas acciones, pipeline mini, últimas llamadas — replicando el artboard 03.
- `Buildings` (tabla densa Attio) + `BuildingDetail` (header con dirección, tabs, cuotas, timeline).
- `Assets` + `AssetDetail` (ficha de cuotas).

### FASE 5 — CRM + Operativo
- `Owners` + `OwnerDetail` con timeline completo de interacciones (clave del producto).
- `Investors` con filtros tipo CRM.
- `Calls` con sentiment IA por fila.
- `CallAnalysis` con waveform, transcript y panel de IA.

### FASE 6 — Pipeline + Operaciones + Cuenta
- `Matching` (activos ↔ inversores, dos columnas con score).
- `Cadences` (builder visual de pasos).
- `Compliance` (checklists jurídicas).
- `PrepareCallWizard` y `AnalyzeCallWizard` (multi-step wizard del artboard 16).
- `Settings` y `NotFound` (404).

---

## Reglas durante toda la implementación

- Cada fase = un solo mensaje, revisable, sin tocar nada fuera de su scope.
- Nunca tocar: `src/integrations/supabase/*`, `.env`, `supabase/config.toml`, edge functions.
- Mantener todas las rutas, hooks, queries y nombres de props existentes.
- i18n: usar las claves de `src/i18n/translations.ts` que ya existan; añadir nuevas solo si hace falta texto nuevo.
- Si una pantalla actual tiene secciones que el HTML no cubre, se mantienen tal cual (no se eliminan features).
- Tras cada fase te confirmo qué tocó y qué queda, para que valides antes de pasar a la siguiente.

---

## Lo que haría primero al aprobar el plan

Solo **FASE 1bis** (tokens). Es un cambio aislado en 2 archivos (`src/index.css`, `tailwind.config.ts`), sin riesgo para componentes, y sienta la base visual correcta antes de tocar nada más.

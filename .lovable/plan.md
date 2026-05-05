## Revert quirúrgico Fase A

Dos cambios aislados. No tocamos estructura, navegación, tipografías ni saludo Dashboard.

---

### 1. Paleta: vuelve champán/dorado sobre el grafito actual

Archivo: `src/index.css`.

**Importante:** se restauran SOLO los tokens de marca/acento. Los tokens de superficie y estado que pediste no tocar (`--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--border`, `--input`, `--destructive`, `--success`, `--warning`, `--info`, `--shadow-*`, `--radius`, `--sidebar-background`, `--sidebar-foreground`) se quedan exactamente como están hoy (grafito #222831 / marfil #eeeeee / etc.). Resultado: panel sigue grafito, pero los CTA, anillos focus, ribbons activos del sidebar y gradientes vuelven a ser champán/dorado real.

**Valores a restaurar (recuperados del commit previo a Fase A — `dd10914`):**

En `:root` (modo claro):
- `--primary: 41 47% 59%` (champán #C9A961)
- `--primary-foreground: 213 52% 11%` (tinta marino, contraste sobre champán)
- `--primary-hover: 40 36% 49%`
- `--primary-soft: 41 47% 92%`
- `--accent: 41 47% 59%`
- `--accent-foreground: 213 52% 11%`
- `--accent-soft: 41 47% 92%`
- `--gold: 41 47% 59%` (real, no alias)
- `--gold-foreground: 213 52% 11%`
- `--gold-soft: 41 47% 92%`
- `--gold-strong: 40 36% 39%`
- `--ring: 41 47% 59%`
- `--gradient-primary: linear-gradient(135deg, hsl(41 47% 59%), hsl(40 36% 49%))`
- `--gradient-accent:  linear-gradient(135deg, hsl(41 47% 59%), hsl(40 36% 39%))`
- `--gradient-hero: radial-gradient(ellipse at top left, hsl(210 14% 16% / 0.06), transparent 55%), radial-gradient(ellipse at bottom right, hsl(41 47% 59% / 0.10), transparent 55%)` (mantengo el grafito del fondo claro actual y solo cambio el halo de acero a champán)
- `--sidebar-primary: 41 47% 59%`
- `--sidebar-ring: 41 47% 59%`

En `.dark` (modo oscuro, default):
- `--primary: 41 47% 59%`
- `--primary-foreground: 213 52% 11%`
- `--primary-hover: 41 50% 65%`
- `--primary-soft: 41 47% 59%` (se usa con /alpha)
- `--accent: 41 47% 59%`
- `--accent-foreground: 213 52% 11%`
- `--accent-soft: 41 47% 59%`
- `--gold: 41 47% 59%`
- `--gold-foreground: 213 52% 11%`
- `--gold-soft: 41 35% 22%`
- `--gold-strong: 40 36% 49%`
- `--ring: 41 47% 59%`
- `--gradient-primary: linear-gradient(135deg, hsl(41 47% 59%), hsl(40 36% 49%))`
- `--gradient-accent:  linear-gradient(135deg, hsl(41 47% 59%), hsl(40 36% 39%))`
- `--gradient-hero: radial-gradient(ellipse at top left, hsl(210 14% 16% / 0.6), transparent 55%), radial-gradient(ellipse at bottom right, hsl(41 47% 59% / 0.10), transparent 55%)` (fondo grafito intacto, halo champán)
- `--sidebar-primary: 41 47% 59%`
- `--sidebar-ring: 41 47% 59%`

Además:
- Eliminar los dos comentarios `TODO legacy alias — limpiar en Fase C…` (ya no aplica, `--gold` vuelve a ser real).
- Actualizar el comentario de cabecera del archivo: cambiar "Acero (#5c848e) como acento único" por "Champán/dorado (#C9A961) como acento sobre fondo grafito" para que el código no mienta.

### 2. Nombre: "Afflux Brain" → "Afflux Property"

**`index.html`:**
- `<title>`: `Afflux Property — Inteligencia operativa para Madrid`
- `<meta name="description">`: `Afflux Property: plataforma operativa interna. Detectar, desbloquear, estructurar y liquidar patrimonio inmobiliario complejo en Madrid.`
- `<meta property="og:site_name">`: `Afflux Property`
- `og:title`, `twitter:title`: `Afflux Property — Inteligencia operativa para Madrid`
- `og:description`, `twitter:description`: `Plataforma operativa interna de Afflux Property: detectar, desbloquear, estructurar, liquidar.`
- Comentario de fuentes: dejar `Tipografía Afflux Property` (cosmético).

**`src/i18n/translations.ts`:**
- `appName: "Afflux Property"`
- `appTagline: ""` (vacío — antes del rebrand no había tagline persistido como literal de marca; mantenerlo vacío evita duplicar "Afflux Property · Afflux Property" allá donde se renderice).

**`src/components/layout/AppSidebar.tsx`:**
- Wordmark del header pasa a `Afflux Property`.
- Eliminar el `<span>` muted que repetía `Afflux Property` debajo (ya no tiene sentido con el wordmark cambiado).
- Mantener `<AqueductLine />` y el resto del bloque tal cual.

**`src/pages/auth/AuthShell.tsx`:**
- Wordmark mobile (`<div class="font-editorial text-2xl…">`): `Afflux Property`.
- Wordmark desktop (`<div class="font-editorial text-3xl…">`): `Afflux Property`.
- Eliminar el `<Eyebrow>Afflux Property</Eyebrow>` redundante bajo el wordmark desktop.
- Mantener `AqueductLine`, el `Eyebrow` editorial "Detectar · Desbloquear · Estructurar · Liquidar", el `<h1>` editorial y el footer "Afflux Property · Madrid · 2026".
- En el bloque mobile, conservar la línea de tagline `Inteligencia operativa para Afflux Property` tal cual (sigue teniendo sentido al haber renombrado solo el wordmark).
- Actualizar comentario JSDoc del componente: `marca Afflux Property`.

**Búsqueda final:** ejecutaré `rg "Afflux Brain"` tras los cambios y, si aparece cualquier otro literal en código (comentarios incluidos), lo reemplazo a `Afflux Property`.

---

### Lo que NO se toca (confirmación)

- Estructura sidebar (4 grupos: Operativa / Captación / IA & Mensajes / Cuenta).
- Bottom nav 4 items.
- Páginas placeholder `/leads`, `/notas-simples`, `/mensajes`.
- Eliminación previa de Compliance / Matching / Cadences / Index.
- Modo oscuro por defecto.
- Topbar sin Beta badge.
- Tipografías Cormorant Garamond + Lato + Geist Mono.
- Saludo Dashboard "Buenos días, Álvaro".
- Tokens de superficie/estado (`--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--border`, `--input`, `--destructive`, `--success`, `--warning`, `--info`, `--shadow-*`, `--radius`, `--sidebar-background`, `--sidebar-foreground`).

### Resultado esperado

Panel grafito + marfil intacto, pero los acentos vuelven a ser champán/dorado real (CTA primary, ribbon activo del sidebar item, anillo focus, halos del hero). Marca textual coherente como "Afflux Property" en title, OG, sidebar y AuthShell.

Tras aprobación, aplico, dejo build limpio y abrimos la decisión Conector nativo Lovable→HubSpot vs Private App.

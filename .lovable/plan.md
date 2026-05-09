# Auth magic-link + C.1 /edificios

## 1. Auth — magic link primary, password secondary

### Backend
- `configure_auth`: `disable_signup: false`, `auto_confirm_email: false`, `password_hibp_enabled: true`, `external_anonymous_users_enabled: false`. Email confirmations ON.
- Migración: actualizar `handle_new_user()` para que el **primer usuario** del sistema reciba rol `admin` automáticamente, el resto `viewer` (mapeo de "comercial" al enum existente `app_role = admin|moderator|viewer` — usamos `viewer` salvo que prefieras añadir `comercial` al enum; lo añado si lo confirmas, default `viewer`).
  ```sql
  IF (SELECT COUNT(*) FROM public.profiles) = 0 THEN
    INSERT user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  ```

### Frontend (`src/pages/auth/Login.tsx`)
- Botón **primario gold**: "Enviar magic link" → `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`. Toast: "Revisa tu email".
- Toggle "Usar contraseña" colapsable debajo (mantener flujo password actual como secundario).
- Botón "Google Workspace" intacto.
- Sin tab signup separado: magic link cubre signup + signin con `shouldCreateUser: true` por defecto.

## 2. C.1 — /edificios lista + filtros + toggle demos

### `src/pages/Buildings.tsx` (rewrite)
- Query Supabase paginada server-side (page size 50, offset/limit) sobre `buildings` con `count: 'exact'`.
- Columnas tabla: Dirección · Ciudad · CP · Nº propietarios · División horizontal · Estado · Última sync.
- Filtros (URL query state via `useSearchParams`):
  - Búsqueda libre (`ilike` sobre `direccion`, `ciudad`, `catastro_ref`).
  - Ciudad (select con distinct values).
  - Estado (`building_status` enum).
  - División horizontal (toggle).
  - **Toggle "Mostrar demos"** — por defecto OFF. Filtra `metadatos->>'seed' IS DISTINCT FROM 'true'`.
- Header: total, filtrados, botón "Nuevo edificio" (ya existe `NewEntityDialogs`).
- Branding Afflux: gold/champán + grafito #222831, Cormorant Garamond títulos, Lato body, eyebrow mono uppercase.
- Loading skeletons, EmptyState cuando 0 resultados.
- Click row → `/edificios/:id` (route ya existe, BuildingDetail).

### Componentes nuevos
- `src/components/buildings/BuildingsFilters.tsx`
- `src/components/buildings/BuildingsTable.tsx`

## 3. Encadenado tras C.1
- C.2 BuildingDetail con tabs (Resumen · Propietarios · Cronología · Activos · Notas) + timeline tasks/calls/notes desde `hubspot_*` joineadas vía `external_ids`.
- C.3+C.4 Owners list + detail (mismo patrón).
- D.1 Notas Simples Analyzer (edge function existente).
- D.2-D.4 + E sin pausa.

## Reglas
- Cero writes a HubSpot. Solo lectura.
- Idempotencia con `onConflict` en upserts.
- No re-preguntar entre fases.

## Pregunta única bloqueante (responde sí/no en una palabra)
¿Añado `comercial` al enum `app_role` o uso `viewer` para usuarios no-admin? Default si no respondes: **`viewer`**.


# Tanda extra: Alta de entidades + relación edificio ↔ propietarios

Antes de seguir con la Tanda 2 (productividad agente), corregimos dos huecos del modelo:

1. **No hay botones para dar de alta** propietarios, edificios, inversores ni activos.
2. **Un edificio tiene varios propietarios** (no 1:1) y dentro de "heredero" hay subtipos (operador, ausente, residente, etc.).

---

## 1. Modelo de datos — cambios

### a) Sub-rol de propietario (más fino que `owner_role`)

Mantenemos `owners.rol` (enum macro) y añadimos un **sub-rol** opcional para detallar la relación con el activo concreto:

```text
owner_role (ya existe):
  particular | heredero | inversor_pasivo | operador_profesional | institucional | desconocido

owner_subrole (NUEVO enum):
  ninguno
  heredero_operador      ← gestiona/explota el inmueble
  heredero_residente     ← vive ahí
  heredero_ausente       ← está fuera, solo cobra
  heredero_conflictivo   ← bloquea decisiones
  arrendador             ← alquila a terceros
  usufructuario
  nudo_propietario
  apoderado
```

### b) Relación N:N edificio ↔ propietarios

Hoy `assets.owner_id` es 1:1. Un edificio real tiene varios propietarios. Creamos una tabla puente:

```sql
building_owners (
  building_id uuid,
  owner_id uuid,
  cuota numeric,           -- % de propiedad (opcional)
  subrole owner_subrole,   -- rol específico en este edificio
  rol_notas text,
  created_at timestamptz,
  PRIMARY KEY (building_id, owner_id)
)
```

Añadimos también `owners.subrole` por defecto (cuando el propietario solo está ligado a un activo, no edificio).

Las RLS siguen el patrón `preview_all_*` actual (estamos en preview sin auth).

### c) `buildings.numero_propietarios` se calcula

Pasa a ser informativo/derivado: la cuenta real sale de `building_owners`. No tocamos la columna pero la página de edificios mostrará el `count` real.

---

## 2. Botones "+ Nuevo" en todas las páginas índice

Patrón unificado: en `PageHeader.actions` añadimos un botón `+ Nuevo X` que abre un **`Dialog`** con un formulario corto (los campos mínimos para crear, no el detalle completo).

| Página | Botón | Diálogo crea |
|---|---|---|
| `/propietarios` | `+ Nuevo propietario` | nombre, email, teléfono, rol, subrole, consentimiento |
| `/edificios` | `+ Nuevo edificio` | dirección, ciudad, CP, división horizontal, nº propietarios estimado |
| `/inversores` | `+ Nuevo inversor` | nombre, email, teléfono, ticket min/max, ciudades (chips), tipos_activo (chips), consentimiento |
| `/activos` | `+ Nuevo activo` | tipo, ubicación, ciudad, superficie, edificio (select), propietario principal (select), estado |

Todos validan con `react-hook-form` + `zod` (ya disponibles en el stack shadcn).
Tras crear, hacen `refetch` de la lista y muestran `toast.success`.

---

## 3. Detalle de edificio nuevo (`/edificios/:id`)

Nueva página `BuildingDetail.tsx` con:

- **Cabecera**: dirección, ciudad, DH, estado.
- **Pestaña Propietarios** (la importante):
  - Lista de `building_owners` con: nombre · subrole · cuota · enlace al propietario.
  - Botón **`+ Añadir propietario`**: dialog con `Combobox` para buscar propietario existente (o "Crear nuevo" inline) + selector de subrole + cuota opcional.
  - Botón quitar (✕) por fila.
- **Pestaña Activos**: lista de `assets` cuyo `building_id = id`, con CTA "Crear activo en este edificio".
- **Pestaña Llamadas**: agregadas de todos los propietarios del edificio (vista unificada, útil para "qué se ha hablado en este edificio").

`Buildings.tsx` (índice) pasa a tabla con columnas: dirección · ciudad · nº propietarios reales (count) · estado · DH. Click navega a `/edificios/:id`.

---

## 4. Detalle de propietario — mostrar subrole

En `OwnerDetail.tsx` cabecera:
- Badge actual `rol` + nuevo badge `subrole` (si existe).
- Nueva pestaña **"Edificios"** que lista los `building_owners` del propietario (en qué edificios está y con qué cuota/subrole).

En `AssetDetail.tsx` pestaña "Owners" pasa a listar **todos los propietarios del edificio** asociado (vía `building_owners`), no solo `assets.owner_id`. El `assets.owner_id` queda como "propietario principal/contacto".

---

## 5. Wizard "Preparar llamada" — adaptado

En el paso de "elegir propietario": si el activo tiene edificio, mostrar **todos los propietarios del edificio** con sus subroles, para que el agente elija con quién va a hablar (un edificio con 5 herederos → 5 opciones, cada una con su rol). Esto es lo que pediste: "dentro del activo selecciona el propietario, dentro de esos propietarios cuál es y qué tipo de rol tiene".

---

## 6. Command Palette (⌘K)

Añadir comandos rápidos: `Nuevo propietario`, `Nuevo edificio`, `Nuevo inversor`, `Nuevo activo` (abren los diálogos directamente).

---

## Detalles técnicos

**Migración SQL**:
```sql
CREATE TYPE owner_subrole AS ENUM (
  'ninguno','heredero_operador','heredero_residente','heredero_ausente',
  'heredero_conflictivo','arrendador','usufructuario','nudo_propietario','apoderado'
);
ALTER TABLE owners ADD COLUMN subrole owner_subrole NOT NULL DEFAULT 'ninguno';

CREATE TABLE building_owners (
  building_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  cuota numeric,
  subrole owner_subrole NOT NULL DEFAULT 'ninguno',
  rol_notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (building_id, owner_id)
);
ALTER TABLE building_owners ENABLE ROW LEVEL SECURITY;
-- 4 políticas preview_all_* (select/insert/update/delete) idénticas al resto.
CREATE INDEX idx_building_owners_building ON building_owners(building_id);
CREATE INDEX idx_building_owners_owner ON building_owners(owner_id);
```

**Componentes nuevos**:
- `src/components/forms/NewOwnerDialog.tsx`
- `src/components/forms/NewBuildingDialog.tsx`
- `src/components/forms/NewInvestorDialog.tsx`
- `src/components/forms/NewAssetDialog.tsx`
- `src/components/forms/AddOwnerToBuildingDialog.tsx`
- `src/pages/BuildingDetail.tsx`

**Rutas nuevas**: `/edificios/:id` → `BuildingDetail`.

**i18n**: añadir `forms.*` y `subroles.*` en `es` y `en`.

**Lo que NO cambia**: tablas existentes (solo se añaden columnas), wizards de análisis, sistema de RAG/agentes, RLS pattern actual.

---

## Orden de ejecución

1. Migración (enum + tabla + columna).
2. 4 diálogos "+ Nuevo" + cableado en `PageHeader` de cada índice.
3. `BuildingDetail.tsx` + ruta + diálogo "Añadir propietario al edificio".
4. Pestaña "Edificios" en `OwnerDetail` + subrole badge.
5. Adaptar wizard "Preparar llamada" para listar todos los propietarios del edificio.
6. Comandos `Nuevo X` en `CommandPalette`.

Después continuamos con la **Tanda 2 (productividad agente)** que quedó pendiente.

¿Le doy?

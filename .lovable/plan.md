## Resumen
Cambios sólo de UI en `/next-actions`:
1. Traducir terminología al castellano.
2. Sustituir chips de filtro por **dos desplegables** (Origen, Urgencia).
3. Añadir **"Próximas acciones"** al menú lateral, dentro del grupo **IA** (junto a Asistente y Mensajes).

## 1. Glosario (etiquetas en UI, sin tocar BD)

| Interno | UI |
|---|---|
| Stale Deal Reviver / `stale_deal_reviver` | **Oportunidades dormidas** |
| Pipeline Hygiene Coach / `pipeline_hygiene` | **Higiene del pipeline** |

Definiciones cortas que se mostrarán como ayuda bajo el título de la página:
- **Oportunidades dormidas**: edificios sin actividad en HubSpot (llamadas, notas, tareas o cambios) durante más de 14 días y que no están en una etapa final.
- **Higiene del pipeline**: deals con datos incompletos — sin tarea siguiente, sin fecha de cierre, sin propietario, en negociación >30 días, sin importe o sin contacto asociado.

## 2. `src/pages/NextActions.tsx`

- Cabecera: bajo el título, párrafo `text-muted-foreground` con las dos definiciones.
- Botones:
  - "Recalcular Stale" → **"Recalcular dormidas"**
  - "Recalcular Hygiene" → **"Recalcular higiene"**
- Reemplazar la fila de chips por dos `Select` (shadcn) en una fila:

  ```text
  [ Origen: Todos ▾ ]   [ Urgencia: Todas ▾ ]      12 de 758 acciones
  ```

  - **Origen**: `Todos` · `Oportunidades dormidas` · `Higiene del pipeline`. Sigue filtrando por valor interno (`stale_deal_reviver`, `pipeline_hygiene`).
  - **Urgencia**: `Todas` · `Alta` · `Media` · `Baja`. Mantiene la lógica de buscar `[ALTA] / [MEDIA] / [BAJA]` en `titulo`.
- Columna **Origen** de la tabla: en lugar del código crudo, un `Badge` con la etiqueta en castellano (color distinto para dormidas vs higiene).
- Estado vacío: "No hay acciones con esos filtros".

## 3. Menú lateral — `src/components/layout/AppSidebar.tsx`

Añadir entrada en el grupo **IA** (`groupIA`), justo después de Mensajes:

```ts
const ia: Item[] = [
  { url: "/asistente", label: t.nav.assistant, icon: MessageSquare },
  { url: "/mensajes",  label: t.nav.mensajes,  icon: Megaphone },
  { url: "/next-actions", label: "Próximas acciones", icon: ListChecks },
];
```

- Importar `ListChecks` de `lucide-react`.
- Si existe `t.nav.nextActions` en `src/i18n/`, usarlo; si no, hardcode `"Próximas acciones"` (consistente con otras etiquetas) y añadir la clave en el i18n provider en una iteración posterior si se requiere bilingüe.
- `BottomNav.tsx`: revisar si replica los grupos del sidebar; si lo hace, añadir también la entrada para mantener paridad móvil. Si no lo hace, no tocar.

## 4. Lo que NO cambia
- Edge functions `detect_stale_deals` y `detect_pipeline_hygiene`.
- Valores almacenados en `next_actions.origen` (siguen siendo `stale_deal_reviver` y `pipeline_hygiene`).
- Cron jobs `stale-daily` y `hygiene-daily`.
- HubSpot read-only.
- Lógica del Dashboard (sólo se traducirán strings si aparece literalmente "Pipeline Hygiene" o "Stale Deal Reviver" en la tile que enlaza a `/next-actions`).

## Detalles técnicos
- Componentes shadcn: `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`, `Badge`.
- Mapa de etiquetas reutilizable:
  ```ts
  const ORIGEN_LABEL: Record<string,string> = {
    stale_deal_reviver: "Oportunidades dormidas",
    pipeline_hygiene:   "Higiene del pipeline",
  };
  ```
- Sin nuevas dependencias.

## Coach IA contextual al comercial visualizado

### Cambio conceptual

La pestaña **Coach IA** deja de ser una vista global "genera reportes para todos" y pasa a ser una vista del comercial actualmente seleccionado en el filtro superior, con cuatro ventanas temporales en sub-pestañas.

### UI nueva

```text
[ Filtro global superior: Comercial = Jesús Anzola | Rango = 90d (afecta resto de tabs) ]

Tab "Coach IA"
  ├─ Sub-tabs: [ Última semana ] [ Último mes ] [ Últimos 3 meses ] [ Último año ]
  └─ Contenido: tarjeta única con fortalezas / mejoras / frases / plan
                + métricas del periodo (calls, conversión, sent+, dur. media)
                + botón "Regenerar"
```

- Si en el filtro global hay **"Todos"** → la pestaña muestra un empty state: *"Selecciona un comercial en el filtro superior para ver su análisis Coach IA."*
- Cada sub-tab mapea a un rango fijo terminado hoy: 7d, 30d, 90d, 365d.
- Al entrar a una sub-tab:
  1. Busca un reporte existente en `coach_reports` para `(comercial_hs_id, week_start = inicio_del_rango)`.
  2. Si existe y `generated_at` < 24h → lo muestra directamente.
  3. Si no existe o está caducado → llama al edge function con `{ from, to, comercial_hs_id }` y muestra spinner.
- Botón **"Regenerar"** fuerza una nueva llamada al LLM aunque haya cache fresco.

### Cambios

**`src/pages/Productividad.tsx`**
- Eliminar de la pestaña Coach: date range picker, quick-picks 7d/30d/90d, selector de comercial interno y botón "Generar Coach IA" global.
- Añadir sub-tabs (`Tabs` shadcn) con 4 ventanas.
- Hook `useCoachReport(comercial_hs_id, windowKey)` que:
  - Consulta `coach_reports` por `(comercial_hs_id, week_start)`.
  - Si vacío → invoca `generate_coach_report` con `{ from, to, comercial_hs_id }` y refresca.
- Estado local de loading por sub-tab.

**Backend (sin cambios)**
- `generate_coach_report` ya soporta `from`/`to`/`comercial_hs_id` y persiste con delete-then-insert sobre `(comercial_hs_id, week_start)`. Reutilizamos tal cual; solo el frontend cambia la forma de consumirlo.

### Persistencia

Mantenemos `coach_reports` como cache (no como histórico): cada (comercial, ventana) tiene una sola fila vigente; al regenerar se sobrescribe. Esto evita llamadas LLM repetidas al cambiar de sub-tab y al recargar la página, sin acumular reportes obsoletos.

### Nota

El selector de **Rango** del filtro superior sigue afectando a Resumen / Heatmap / Comparativa / Objeciones, pero **no** a Coach IA (Coach tiene sus propias ventanas en sub-tabs). Esto evita confusión cuando el usuario está mirando "últimos 90d" arriba pero quiere ver un coaching de "última semana".
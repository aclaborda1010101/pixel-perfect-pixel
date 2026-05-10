## Selector de comercial en Coach IA

En la pestaña **Coach IA** de `/productividad`, junto al rango de fechas y al botón "Generar Coach IA", añadir un `Select` con la lista de comerciales reales (los mismos que ya alimenta `comercialesWithCalls`):

- Opción por defecto: **"Todos los comerciales"** → comportamiento actual (genera reportes para todos los activos en el rango).
- Resto de opciones: cada comercial con su nombre real y nº de calls (ej. `Jesús Anzola · 507`).

### Backend

`generate_coach_report` ya acepta `comercial_hs_id` en el body y devuelve un único reporte. Solo hay que pasarlo desde el frontend cuando esté seleccionado:

```ts
const body = selCoachComercial === "all"
  ? { from, to, chain: true }
  : { from, to, comercial_hs_id: selCoachComercial };
```

### UX

- Si se selecciona un comercial con <10 calls en el rango, el reporte resultante mostrará el plan "muestra insuficiente" que ya implementamos (sin llamar al LLM, sin coste).
- Tras generar, el toast indica el comercial concreto: `Reporte generado para Jesús Anzola (507 calls)`.
- La lista de tarjetas se sigue refrescando como hasta ahora vía `load()`.

### Cambios

- `src/pages/Productividad.tsx`: nuevo state `selCoachComercial`, `Select` en el panel de Coach IA, lógica condicional en `generateCoachAll()`. Sin tocar backend ni esquema.
## Paginación server-side + buscador real en /edificios y /propietarios

### Problema

PostgREST tiene `max-rows=1000` como límite duro del servidor (no se puede subir desde el cliente con `.range()`). Por eso /edificios y /propietarios sólo muestran 1000 de los 7703 / 7616 reales.

### Solución

Paginación server-side (50 por página) con buscador y filtro que ejecutan la query en el servidor, no en memoria. Así trabajas con 7700 filas sin descargarlas todas y la UX escala.

### Cambios

**1. `src/pages/Buildings.tsx`**

- Estado nuevo: `page` (0..N), `pageSize=50`, `total` (count exact), `loading`.
- `load()` reescrito:
  - Construye query con `.select("*", { count: "exact" })`.
  - Aplica `.ilike("direccion", \`%${q}%\`)` (o `or(direccion.ilike,ciudad.ilike,codigo_postal.ilike)`) cuando hay búsqueda.
  - Aplica `.eq("estado", filter)` cuando filtro != "all".
  - `.order("updated_at", desc).range(page*50, page*50+49)`.
  - Lee `count` para pintar total real y calcular `Math.ceil(count/50)` páginas.
- `counts` (propietarios por edificio): se sigue cargando sólo para los 50 visibles vía `.in("building_id", visibleIds)`.
- Debounce 250 ms en `q` para no spamear el servidor en cada tecla.
- Resetear `page=0` cuando cambia `q` o `filter`.
- Métricas superiores (Total edificios, Propietarios vinculados, DH): pasan a leer de queries `count` independientes (3 HEADs ligeros en paralelo) en lugar de calcular sobre `rows`. Así reflejan los 7703 reales, no los 50 de la página.
- Nuevo componente footer de tabla: `« Anterior  Página X / Y  Siguiente »` + texto `Mostrando 51-100 de 7703`.

**2. `src/pages/Owners.tsx`**

Mismo patrón:
- `page`, `pageSize=50`, `total`, `loading`.
- Query con `count: "exact"`, búsqueda `or(nombre.ilike,email.ilike,telefono.ilike)`, filtro `eq("rol", rolFilter)`, `range`.
- Métricas (Total, Con consentimiento, Sin rol catalogado) → 3 queries `count` independientes.
- Mismo footer de paginación, mismo debounce.

**3. Limpieza**

- Quitar el `.range(0, 9999)` previo (queda sin uso al haber paginación real).
- Quitar el filtrado en memoria (`useMemo` que filtra `data`/`rows`): ahora la query ya viene filtrada del servidor; sólo se renderiza directo.

### Lo que NO se toca

- Schema DB.
- RLS.
- Edge functions HubSpot.
- Sync (sigue 7694 deals + 7616 contacts intactos).
- Otras páginas (/leads, /inversores, /llamadas, dashboard).
- Diseño visual de la tabla y cards mobile.

### Detalles técnicos

```ts
// patrón de query paginada con búsqueda
let query = supabase
  .from("buildings")
  .select("*", { count: "exact" })
  .order("updated_at", { ascending: false });

if (debouncedQ) {
  query = query.or(
    `direccion.ilike.%${debouncedQ}%,ciudad.ilike.%${debouncedQ}%,codigo_postal.ilike.%${debouncedQ}%`
  );
}
if (filter !== "all") query = query.eq("estado", filter);

const { data, count } = await query.range(page * 50, page * 50 + 49);
```

`count: "exact"` añade `Prefer: count=exact` y devuelve total real ignorando `max-rows` (sólo se aplica al payload de filas).

### Resultado esperado

- /edificios muestra "Total edificios: 7703" en la métrica y la tabla pagina 50 a 50 con buscador funcionando sobre los 7703 reales.
- /propietarios muestra "Total: 7616" y pagina igual.
- Carga rápida (50 filas por request en lugar de 1000+).
- El sync HubSpot se mantiene tal cual.

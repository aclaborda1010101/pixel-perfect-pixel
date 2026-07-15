## Problema

En `src/pages/comercial/Edificios.tsx`, en la query del tab "Todos" (líneas ~385-408), la carga se limitó a los TOP 1.000 por score con una sola página de `range(0, 999)`:

```ts
const PAGE = 1000;
// ...
const scores: any[] = firstPage.data ?? [];  // solo primera página
```

Eso era una optimización mía para evitar 2-3s de descarga extra, pero deja fuera los ~100-300 edificios con score más bajo. El usuario los quiere ver todos.

## Solución

Restaurar la paginación completa manteniendo el resto de optimizaciones (fetch de columnas pesadas solo para IDs que se van a pintar, ordenación por score, misma query shape).

Cambio en `Edificios.tsx` dentro del `queryFn` del tab "todos":

- Sustituir la carga single-page por un bucle `while` que consume páginas de 1.000 hasta que la respuesta devuelva menos de 1.000 filas (patrón habitual de paginación Supabase — el límite hard es 1000/req).
- Concatenar todos los resultados en `scores` antes de continuar.
- Mantener `.order("score", { ascending: false })` para que los mejores sigan arriba.
- Mantener `staleTime: 5 * 60_000` y `enabled: tab === "todos"` para que la carga siga siendo lazy y cacheada.

Resultado esperado: ~1.100-1.300 edificios visibles. Coste extra: 1-2 requests adicionales de ~200 filas cada uno, solo la primera vez que se abre el tab (luego cachea 5 min). Es asumible — la optimización real de perf ya la aportan el `enabled` (lazy) + el fetch selectivo de columnas + el `staleTime`.

## Archivos

- `src/pages/comercial/Edificios.tsx` — sustituir el bloque `fetchPage(0)` por un loop de paginación hasta agotar resultados.

## Verificación

Abrir `/comercial/edificios` → tab "Todos" → contador de tarjetas debe coincidir con el total real de la tabla `buildings` (o el filtro de scoring aplicado en `v_building_score`).

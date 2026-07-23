## 1. Crear usuario para David Casero

- Alta en `auth.users` con email `david.casero@afflux.es` y contraseña `Afflux2026!` (email auto-confirmado, igual que Jesús).
- Insertar fila en `public.user_roles` con rol `comercial_zona` (mismo rol que Jesús).
- Verificación: consulta a `auth.users` + `user_roles` para confirmar creación.

Resultado: David podrá iniciar sesión y verá exactamente las mismas pantallas que Jesús (Inicio · Scoring total · Tareas · Llamadas · Productividad · Asistente · Mi cuenta).

## 2. Ocultar "Oportunidades" temporalmente

Edición en `src/components/layout/AppSidebar.tsx`:
- Retirar el ítem `{ url: "/oportunidades", label: "Oportunidades", ... }` de las listas `operativa` tanto para rol `comercial_zona` como para el resto de roles (admin/captación).
- Retirar el `useQuery` de `unassignedCount` y su badge (ya no se usa, evita llamadas innecesarias).

Se mantienen intactos:
- La ruta `/oportunidades` y la página `Oportunidades.tsx` (para reactivar rápidamente).
- La lógica de auto-asignación por zona en el backend.
- Las RLS y columnas añadidas ayer.

Sólo desaparece la entrada del menú lateral.

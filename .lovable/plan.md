# Fix redirect loop tras login

## Causa
`ProtectedRoute` recibe `isAuthenticated` como prop (default `false`) pero `App.tsx` nunca se la pasa → siempre redirige a `/login`. Y como `Login.tsx` redirige al detectar sesión, se crea un loop infinito (`Maximum update depth exceeded`).

## Solución (1 archivo)

Reescribir `src/components/auth/ProtectedRoute.tsx` para que consuma `useAuth()` directamente:

```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE } from "@/lib/config";

export function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (DEMO_MODE) return children ?? <Outlet />;
  if (loading) return null; // o un splash mínimo
  if (!session) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children ?? <Outlet />;
}
```

Esto:
- Elimina el redirect mientras se hidrata la sesión (`loading=true`).
- Usa la sesión real, no el prop hardcoded a `false`.
- Soporta tanto wrap (`<ProtectedRoute><X/></ProtectedRoute>`) como layout-route con `<Outlet/>` (App.tsx usa este patrón).

Tras el fix, el flujo será: login → toast "Sesión iniciada" → `Login.tsx` ve `session` → `navigate("/")` → `ProtectedRoute` ve sesión → renderiza `AppLayout` + Dashboard.

No hay cambios en backend ni en otros componentes.

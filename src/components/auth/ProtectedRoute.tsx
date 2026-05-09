import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { DEMO_MODE } from "@/lib/config";
import { useAuth } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children?: ReactNode;
  redirectTo?: string;
}

/**
 * Guard de rutas. Si DEMO_MODE está activo, deja pasar siempre.
 * Si no hay sesión, redirige a /login. Espera a que termine la hidratación
 * de la sesión para evitar bucles de redirección.
 */
export function ProtectedRoute({ children, redirectTo = "/login" }: ProtectedRouteProps) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (DEMO_MODE) return <>{children ?? <Outlet />}</>;
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
          Cargando…
        </div>
      </div>
    );
  }
  if (!session) {
    return <Navigate to={redirectTo} state={{ from: location.pathname }} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

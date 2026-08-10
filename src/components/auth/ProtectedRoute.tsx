import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { DEMO_MODE } from "@/lib/config";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useMustChangePassword } from "@/hooks/useMustChangePassword";
import { decideAccess } from "@/lib/access";

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
  const { role, loading: roleLoading } = useCurrentRole();
  const { mustChange, loading: pwdLoading } = useMustChangePassword();

  if (DEMO_MODE) return <>{children ?? <Outlet />}</>;
  if (loading || (session && (roleLoading || pwdLoading))) {
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
  const decision = decideAccess({ role, pathname: location.pathname, mustChangePassword: mustChange });
  if (decision.type === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

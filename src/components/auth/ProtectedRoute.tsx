import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { DEMO_MODE } from "@/lib/config";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useMustChangePassword } from "@/hooks/useMustChangePassword";
import { decideAccess } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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
  const { mustChange, loading: pwdLoading, error: pwdError, refetch: refetchPwd } = useMustChangePassword();

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
  // Falla cerrado: sin poder verificar el estado de la contraseña no se entra.
  if (pwdError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">No se puede verificar tu cuenta</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            No hemos podido comprobar si debes cambiar la contraseña, así que el acceso queda bloqueado por seguridad.
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">{pwdError.message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetchPwd()}>Reintentar</Button>
          <Button onClick={() => supabase.auth.signOut()}>Cerrar sesión</Button>
        </div>
      </div>
    );
  }
  const decision = decideAccess({ role, pathname: location.pathname, mustChangePassword: mustChange });
  if (decision.type === "redirect") {
    return <Navigate to={decision.to} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { DEMO_MODE } from "@/lib/config";

interface ProtectedRouteProps {
  children: ReactNode;
  isAuthenticated?: boolean;
  redirectTo?: string;
}

/**
 * Guard de rutas. Si DEMO_MODE está activo, deja pasar siempre.
 * En modo normal, redirige a /login cuando no hay sesión.
 */
export function ProtectedRoute({
  children,
  isAuthenticated = false,
  redirectTo = "/login",
}: ProtectedRouteProps) {
  if (DEMO_MODE) return <>{children}</>;
  if (!isAuthenticated) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}

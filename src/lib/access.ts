export type AccessRole =
  | "admin"
  | "sales_manager"
  | "captacion"
  | "comercial_zona"
  | "prevalificacion"
  | "viewer"
  | "whatsapp"
  | null;

export const GESTOR_PATH = "/gestor-comerciales";
export const PASSWORD_PATH = "/cambiar-password";

/** Rutas que sólo puede ver un admin general. */
export function isAdminOnlyPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function canAccessGestor(role: AccessRole): boolean {
  return role === "admin" || role === "sales_manager";
}

/** Mínimo privilegio: rutas permitidas a sales_manager. */
export const SALES_MANAGER_ALLOWED = [GESTOR_PATH, PASSWORD_PATH, "/logout"] as const;

export function isSalesManagerAllowedPath(pathname: string): boolean {
  return SALES_MANAGER_ALLOWED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/** Destino tras completar el cambio de contraseña obligatorio. */
export function postPasswordChangePath(role: AccessRole): string {
  return role === "sales_manager" ? GESTOR_PATH : "/";
}

export type AccessDecision =
  | { type: "allow" }
  | { type: "redirect"; to: string };

/**
 * Decisión pura de acceso para una ruta protegida.
 * Orden: cambio de contraseña obligatorio > restricciones por rol.
 */
export function decideAccess(params: {
  role: AccessRole;
  pathname: string;
  mustChangePassword?: boolean;
}): AccessDecision {
  const { role, pathname, mustChangePassword } = params;

  if (mustChangePassword && pathname !== PASSWORD_PATH) {
    return { type: "redirect", to: PASSWORD_PATH };
  }
  if (!mustChangePassword && pathname === PASSWORD_PATH) {
    return { type: "redirect", to: "/" };
  }

  // Rol whatsapp: sólo /whatsapp
  if (role === "whatsapp" && !pathname.startsWith("/whatsapp")) {
    return { type: "redirect", to: "/whatsapp" };
  }

  if (role === "sales_manager") {
    // Sólo su panel (y cambio de contraseña / logout). Todo lo demás, incluido /admin*.
    if (!isSalesManagerAllowedPath(pathname)) return { type: "redirect", to: GESTOR_PATH };
    return { type: "allow" };
  }

  // Panel de gestión comercial: sólo admin o sales_manager
  if (pathname.startsWith(GESTOR_PATH) && !canAccessGestor(role)) {
    return { type: "redirect", to: "/" };
  }

  return { type: "allow" };
}

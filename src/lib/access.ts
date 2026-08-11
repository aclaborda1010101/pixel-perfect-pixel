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

/**
 * Excepciones legítimas dentro de /admin: NINGUNA hoy.
 * Si alguna vez hace falta abrir una pantalla concreta, se añade su ruta
 * EXACTA aquí (nunca un prefijo amplio) y se cubre con test explícito.
 */
export const ADMIN_PATH_EXCEPTIONS: readonly string[] = [] as const;

/** Rutas que sólo puede ver un admin general: todo /admin y /admin/*. */
export function isAdminOnlyPath(pathname: string): boolean {
  const isAdminArea = pathname === "/admin" || pathname.startsWith("/admin/");
  if (!isAdminArea) return false;
  // Coincidencia EXACTA para la allowlist; un prefijo nunca abre una subruta.
  return !ADMIN_PATH_EXCEPTIONS.includes(pathname);
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

  // Área de administración: SIEMPRE lo último antes del allow final.
  // Cualquier rol distinto de admin queda fuera de /admin/* (incluida
  // /admin/cola-simulada y cualquier ruta futura), también por URL directa.
  if (isAdminOnlyPath(pathname) && role !== "admin") {
    return { type: "redirect", to: "/" };
  }

  return { type: "allow" };
}

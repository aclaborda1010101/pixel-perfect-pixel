/**
 * Flags de configuración global del cliente.
 * No leer de .env: estas flags son de build/UI puramente.
 */

/**
 * Cuando es true, los guards de autenticación (p.ej. <ProtectedRoute />)
 * dejan pasar a cualquier ruta sin redirigir a /login.
 *
 * Útil mientras pulimos la UI sin sesión activa.
 * Poner a false para reactivar el comportamiento normal del guard.
 */
export const DEMO_MODE = true;

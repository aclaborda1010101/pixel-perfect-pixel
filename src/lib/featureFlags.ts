/**
 * Feature flags estáticos. Todo lo que aún no está conectado a producción
 * vive aquí desactivado por defecto.
 */

/** Adaptador de reparto ponderado por modo. DESACTIVADO: no altera la generación real. */
export const FEATURE_SALES_TASK_MODE_ALLOCATOR = false;

/** Cambio obligatorio de contraseña vía edge function (no desplegada todavía). */
export const FEATURE_FORCE_PASSWORD_EDGE_FN = false;

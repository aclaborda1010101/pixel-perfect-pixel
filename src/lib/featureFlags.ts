/**
 * Feature flags estáticos. Todo lo que aún no está conectado a producción
 * vive aquí desactivado por defecto.
 */

/** Adaptador de reparto ponderado por modo. DESACTIVADO: no altera la generación real. */
export const FEATURE_SALES_TASK_MODE_ALLOCATOR = false;

/** Cambio obligatorio de contraseña vía edge function (no desplegada todavía). */
export const FEATURE_FORCE_PASSWORD_EDGE_FN = false;

/**
 * Motor V5 Fase A (modelo + elegibilidad/precedencia + modos puros).
 * DESACTIVADO: no genera tareas reales, no hay UI operativa conectada.
 */
export const FEATURE_V5_ENGINE_PHASE_A = false;

/**
 * Adaptador RUNTIME del Motor V5 (P0.2): sustituye a la cola legacy detrás
 * de este flag. OFF: la cola antigua NO inserta ninguna tarea nueva (T-XX
 * incluido) y el motor no escribe. ON: sólo Motor V5, una tarea por
 * comercial y ciclo. Contrato de canario, sin cron ni deploy.
 */
export const FEATURE_V5_RUNTIME_ADAPTER = false;

/**
 * Reexport del generador continuo de tareas.
 * La implementación vive en supabase/functions/_shared/generadorTareas.ts
 * y la comparten frontend, Edge y tests. No dupliques lógica aquí.
 */
export * from "../../supabase/functions/_shared/generadorTareas.ts";

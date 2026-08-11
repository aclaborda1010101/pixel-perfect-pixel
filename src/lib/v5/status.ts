/**
 * MOTOR V5 — reexport del MOTOR CANÓNICO PORTABLE.
 * La implementación vive en supabase/functions/_shared/v5Engine/status.ts
 * y es compartida por frontend, Edge (Deno) y tests. No dupliques lógica aquí.
 */
export * from "../../../supabase/functions/_shared/v5Engine/status.ts";

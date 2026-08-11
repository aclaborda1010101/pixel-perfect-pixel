import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** El panel del gestor no debe consultar tablas sensibles directamente. */
describe("panel de gestor: cero consultas directas", () => {
  const panel = readFileSync("src/pages/GestorComerciales.tsx", "utf8");
  const modos = readFileSync("src/components/gestor/ModosTareasCard.tsx", "utf8");
  const hook = readFileSync("src/hooks/useSalesManagerDashboard.ts", "utf8");

  it("no usa supabase.from(...) en la página ni en el hook", () => {
    expect(panel).not.toMatch(/supabase\s*\n?\s*\.from\(/);
    expect(panel).not.toContain('from("building_tasks"');
    expect(panel).not.toContain('from("profiles"');
    expect(hook).not.toMatch(/\.from\(/);
  });

  it("sólo llama a RPC agregadas", () => {
    expect(hook).toContain("get_sales_manager_dashboard");
    expect(hook).toContain("get_sales_task_mode_config");
    expect(modos).toContain("set_sales_task_mode");
    expect(modos).not.toMatch(/\.from\(/);
  });

  it("muestra estados de carga, error y vacío", () => {
    expect(panel).toContain("isLoading");
    expect(panel).toContain("Error al cargar los datos");
    expect(panel).toContain("Sin tareas en el periodo seleccionado");
  });
});

describe("migración pendiente sales_manager", () => {
  const sql = readFileSync(
    "supabase/pending_migrations/20260811000000_sales_manager_phase_b.sql",
    "utf8",
  );

  it("aborta si falta el valor sales_manager en el enum", () => {
    expect(sql).toContain("no contiene el valor sales_manager");
  });

  it("crea columnas e índices sin inventar históricos", () => {
    expect(sql).toContain("must_change_password boolean NOT NULL DEFAULT false");
    expect(sql).toContain("started_at timestamptz NULL");
    expect(sql).toContain("building_tasks_user_created_idx");
    // No hay backfill del histórico: started_at nunca se deriva de otra columna.
    expect(sql).not.toMatch(/started_at\s*=\s*(created_at|completed_at)/i);
  });

  it("no concede lectura global de building_tasks al gestor", () => {
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON public\.building_tasks/i);
  });

  it("todas las RPC son SECURITY DEFINER con search_path fijo y sin anon", () => {
    const fns = [
      "get_sales_manager_dashboard",
      "get_sales_task_mode_config",
      "set_sales_task_mode",
      "start_building_task",
      "finalize_sales_manager_setup",
    ];
    for (const fn of fns) {
      const i = sql.indexOf(`FUNCTION public.${fn}`);
      expect(i, fn).toBeGreaterThan(-1);
      expect(sql.slice(i, i + 4000)).toContain("SECURITY DEFINER");
      expect(sql.slice(i, i + 4000)).toContain("SET search_path = public");
      expect(sql).toContain(`FROM PUBLIC, anon`);
    }
    expect(sql).not.toMatch(/EXECUTE\s+format\(/i);
  });

  it("valida la suma exacta de 100 y audita el cambio", () => {
    expect(sql).toContain("la suma de pesos debe ser exactamente 100");
    expect(sql).toContain("INSERT INTO public.sales_task_mode_audit");
  });

  it("start_building_task es idempotente y sólo del propietario", () => {
    const i = sql.indexOf("FUNCTION public.start_building_task");
    const body = sql.slice(i, i + 2000);
    expect(body).toContain("COALESCE(started_at, now())");
    expect(body).toContain("la tarea no te pertenece");
  });
});

describe("edge function de contraseña (no desplegada)", () => {
  const fn = readFileSync("supabase/functions/force_password_change/index.ts", "utf8");

  it("usa el JWT propio y no acepta user_id externo", () => {
    expect(fn).toContain("auth.getUser()");
    expect(fn).not.toContain("body?.user_id");
  });

  it("no registra contraseñas ni tokens", () => {
    expect(fn).not.toMatch(/console\.(log|error)\([^)]*password/i);
    expect(fn).not.toMatch(/console\.(log|error)\([^)]*token/i);
  });

  it("informa de estado parcial y mantiene el bloqueo si falla la base", () => {
    expect(fn).toContain('stage: "partial"');
    expect(fn).toContain("must_change_password: true");
    expect(fn).toContain("clearMustChangePassword");
    expect(fn).toContain("PARTIAL_MESSAGE");
  });
});

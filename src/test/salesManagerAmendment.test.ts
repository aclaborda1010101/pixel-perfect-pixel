import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  decideAccess, isAdminOnlyPath, ADMIN_PATH_EXCEPTIONS, GESTOR_PATH,
  type AccessRole,
} from "@/lib/access";

const ROOT = process.cwd();
const PHASE_B = readFileSync(
  resolve(ROOT, "supabase/pending_migrations/20260811000000_sales_manager_phase_b.sql"), "utf8");
// P0.3: la migración BLOQUEADA se sustituye por una FORWARD que porta a los
// consumidores históricos y sólo entonces revoca has_role (fail-closed).
const LOCKDOWN = readFileSync(
  resolve(ROOT, "supabase/pending_migrations/20260813120000_sales_manager_p03_has_role_lockdown.sql"),
  "utf8");

const ROLES: Exclude<AccessRole, null>[] = [
  "admin", "sales_manager", "comercial_zona", "captacion",
  "prevalificacion", "whatsapp", "viewer",
];

// Rutas /admin reales declaradas en App.tsx (incluye /admin/cola-simulada).
const APP = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");
const ADMIN_ROUTES = [...APP.matchAll(/path="(\/admin[^"]*)"/g)]
  .map((m) => m[1].replace(/:\w+/g, "x"));

// ---------------------------------------------------------------------------
// 1) RUTAS ADMIN
// ---------------------------------------------------------------------------
describe("rutas /admin · sólo admin", () => {
  it("App.tsx declara las rutas admin reales, incluida /admin/cola-simulada", () => {
    expect(ADMIN_ROUTES).toContain("/admin/cola-simulada");
    expect(ADMIN_ROUTES.length).toBeGreaterThanOrEqual(10);
  });

  it("isAdminOnlyPath cubre /admin y todo /admin/*, sin excepciones abiertas", () => {
    expect(ADMIN_PATH_EXCEPTIONS).toEqual([]);
    for (const p of [...ADMIN_ROUTES, "/admin", "/admin/ruta-futura", "/admin/x/y"]) {
      expect(isAdminOnlyPath(p), p).toBe(true);
    }
    for (const p of ["/", "/administracion", "/comercial/tareas", GESTOR_PATH, "/whatsapp"]) {
      expect(isAdminOnlyPath(p), p).toBe(false);
    }
  });

  it("matriz completa de roles × rutas admin: sólo admin entra", () => {
    for (const path of [...ADMIN_ROUTES, "/admin/ruta-futura"]) {
      for (const role of ROLES) {
        const d = decideAccess({ role, pathname: path });
        if (role === "admin") expect(d, `${role} ${path}`).toEqual({ type: "allow" });
        else expect(d.type, `${role} ${path}`).toBe("redirect");
      }
      // Sin sesión / sin rol tampoco.
      expect(decideAccess({ role: null, pathname: path }).type).toBe("redirect");
    }
  });

  it("acceso por URL directa: destinos correctos por rol", () => {
    expect(decideAccess({ role: "sales_manager", pathname: "/admin/cola-simulada" }))
      .toEqual({ type: "redirect", to: GESTOR_PATH });
    expect(decideAccess({ role: "whatsapp", pathname: "/admin/cola-simulada" }))
      .toEqual({ type: "redirect", to: "/whatsapp" });
    for (const role of ["comercial_zona", "captacion", "prevalificacion", "viewer"] as const) {
      expect(decideAccess({ role, pathname: "/admin/cola-simulada" }))
        .toEqual({ type: "redirect", to: "/" });
    }
    expect(decideAccess({ role: "admin", pathname: "/admin/cola-simulada" }))
      .toEqual({ type: "allow" });
  });

  it("la comprobación admin se aplica ANTES del allow final", () => {
    const src = readFileSync(resolve(ROOT, "src/lib/access.ts"), "utf8");
    const guard = src.lastIndexOf("isAdminOnlyPath(pathname)");
    const finalAllow = src.lastIndexOf('return { type: "allow" };');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(finalAllow);
    // Y no rompe rutas no-admin de roles operativos.
    expect(decideAccess({ role: "comercial_zona", pathname: "/comercial/tareas" }))
      .toEqual({ type: "allow" });
  });
});

// ---------------------------------------------------------------------------
// 2) has_role: inventario + modelo de permisos
// ---------------------------------------------------------------------------
type Grants = Record<string, Set<string>>;

/** Modelo de privilegios EXECUTE derivado del SQL (PUBLIC por defecto). */
function grantModel(sql: string, fns: string[]): Grants {
  const g: Grants = {};
  for (const fn of fns) g[fn] = new Set(["anon", "authenticated", "service_role"]);
  const stmts = sql.split(";").map((x) => x.replace(/\s+/g, " ").trim());
  for (const line of stmts) {
    const fn = fns.find((f) => line.includes(`FUNCTION public.${f}(`));
    if (!fn) continue;
    const roles = line.includes("PUBLIC")
      ? ["anon", "authenticated", "service_role"]
      : ["anon", "authenticated", "service_role"].filter((r) => line.includes(r));
    if (/^REVOKE/.test(line.trim())) for (const r of roles) g[fn].delete(r);
    if (/^GRANT/.test(line.trim())) for (const r of roles) g[fn].add(r);
  }
  return g;
}

const FNS = ["current_user_has_role", "internal_member_has_role", "current_user_role",
  "is_sales_manager_or_admin", "sales_manager_can_see", "get_agent_display_names"];
const GRANTS = grantModel(PHASE_B, FNS);

describe("has_role · inventario y endpoint seguro", () => {
  it("ningún cliente ni edge function invoca rpc has_role(user_id, role)", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(resolve(ROOT, "src"));
    walk(resolve(ROOT, "supabase/functions"));
    const offenders = files.filter((f) =>
      /rpc\(\s*["']has_role["']/.test(readFileSync(f, "utf8")) && !/[\\/]test[\\/]/.test(f));
    expect(offenders).toEqual([]);
  });

  it("guardas_aprobar valida al usuario leyendo user_roles con el cliente de servicio", () => {
    const src = readFileSync(resolve(ROOT, "supabase/functions/guardas_aprobar/index.ts"), "utf8");
    expect(src).toContain('.from("user_roles")');
    expect(src).toContain('.eq("user_id", user.id)');
    expect(src).not.toMatch(/rpc\(\s*["']has_role["']/);
  });

  it("current_user_has_role NO acepta user_id y fija auth.uid()", () => {
    expect(PHASE_B).toMatch(/FUNCTION public\.current_user_has_role\(_role public\.app_role\)/);
    const body = PHASE_B.slice(
      PHASE_B.indexOf("FUNCTION public.current_user_has_role"),
      PHASE_B.indexOf("REVOKE ALL ON FUNCTION public.current_user_has_role"));
    expect(body).toContain("auth.uid() IS NOT NULL");
    expect(body).toContain("ur.user_id = auth.uid()");
    expect(body).not.toMatch(/_user_id|_uid\s+uuid/);
    expect(body).toContain("SECURITY DEFINER");
    expect(GRANTS.current_user_has_role.has("authenticated")).toBe(true);
    expect(GRANTS.current_user_has_role.has("anon")).toBe(false);
  });

  it("el authenticated no puede preguntar por el rol de un tercero; self sí", () => {
    // Modelo de ejecución: qué puede llamar un authenticated.
    const puedeLlamar = (fn: string, role: string) => GRANTS[fn]?.has(role) ?? false;
    // Enumeración: sólo funciones con parámetro de usuario ajeno.
    for (const fn of ["internal_member_has_role", "is_sales_manager_or_admin", "sales_manager_can_see"]) {
      expect(puedeLlamar(fn, "authenticated"), fn).toBe(false);
      expect(puedeLlamar(fn, "anon"), fn).toBe(false);
      expect(puedeLlamar(fn, "service_role"), fn).toBe(true);
    }
    // Self: sin parámetro de usuario.
    expect(puedeLlamar("current_user_has_role", "authenticated")).toBe(true);
    expect(puedeLlamar("current_user_role", "authenticated")).toBe(true);
  });

  it("la RPC interna valida a un miembro concreto sin devolver listas", () => {
    const body = PHASE_B.slice(
      PHASE_B.indexOf("FUNCTION public.internal_member_has_role"),
      PHASE_B.indexOf("REVOKE ALL ON FUNCTION public.internal_member_has_role"));
    expect(body).toContain("RETURNS boolean");
    expect(body).toContain("FROM public.user_roles");
    expect(body).toContain("ur.user_id = _member");
    expect(body).not.toMatch(/RETURNS TABLE|array_agg/);
  });

  it("las políticas históricas NO se rompen: has_role sigue intacto y sin revocar", () => {
    expect(PHASE_B).not.toMatch(/REVOKE[^\n]*FUNCTION public\.has_role/);
    expect(PHASE_B).not.toMatch(/DROP FUNCTION[^\n]*has_role/);
    expect(PHASE_B).not.toMatch(/CREATE OR REPLACE FUNCTION public\.has_role\(/);
    // Y sus consumidores históricos siguen existiendo (inventario no vacío).
    const dir = resolve(ROOT, "supabase/migrations");
    const consumidores = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && readFileSync(join(dir, f), "utf8").includes("has_role("));
    expect(consumidores.length).toBeGreaterThan(10);
  });

  it("el cierre de has_role es FORWARD, fail-closed y porta a los consumidores", () => {
    // Porta políticas y funciones ANTES de revocar.
    expect(LOCKDOWN).toContain("current_user_has_role");
    expect(LOCKDOWN).toContain("internal_member_has_role");
    expect(LOCKDOWN).toContain("REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role)");
    expect(LOCKDOWN.indexOf("pg_policies"))
      .toBeLessThan(LOCKDOWN.indexOf("REVOKE ALL ON FUNCTION public.has_role"));
    // Preflight: si queda UN consumidor, aborta sin revocar.
    const preflight = LOCKDOWN.indexOf("preflight");
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(LOCKDOWN.indexOf("REVOKE ALL ON FUNCTION public.has_role"));
    expect(LOCKDOWN).toMatch(/RAISE\s+EXCEPTION/);
    // service_role conserva la firma histórica; ningún rol de cliente.
    expect(LOCKDOWN).toContain("GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role");
    expect(LOCKDOWN).toContain("has_role sigue siendo ejecutable por un rol de cliente");
    // La versión BLOQUEADA ya no existe.
    const pend = readdirSync(resolve(ROOT, "supabase/pending_migrations"));
    expect(pend).toContain("20260813120000_sales_manager_p03_has_role_lockdown.sql");
    expect(pend.some((f) => f.startsWith("BLOCKED_"))).toBe(false);
  });

  it("existe el runner de integración en clúster efímero con sus dos suites", () => {
    const runner = readFileSync(resolve(ROOT, "supabase/tests/sales_manager_p03_runner.sh"), "utf8");
    expect(runner).toContain("initdb");
    expect(runner).toContain("sales_manager_p03_rls.sql");
    expect(runner).toContain("sales_manager_p03_metrics.sql");
    expect(runner).toContain("20260813120000_sales_manager_p03_has_role_lockdown.sql");
  });
});

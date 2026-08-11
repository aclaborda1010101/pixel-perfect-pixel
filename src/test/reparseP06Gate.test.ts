/**
 * PUERTA DE CI · REPARSEO P0.6.
 * Ejecuta el runner aislado (cluster PostgreSQL efímero + migraciones
 * pendientes reales + suites de integración) como parte de la suite.
 * Si no hay PostgreSQL local, el runner sale con 3 y aquí se marca SKIP
 * EXPLÍCITO: nunca se declara GO sin verificación.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Dentro del propio runner (P06_LIVE=1) no se re-entra: evita recursión.
const anidado = process.env.P06_LIVE === "1" || process.env.P05_LIVE === "1";
const d = anidado ? describe.skip : describe;

d("Puerta de CI · runner P0.6 contra PostgreSQL efímero", () => {
  it("el runner existe y es ejecutable", () => {
    expect(existsSync("supabase/tests/reparse_p06_runner.sh")).toBe(true);
  });

  it("ejecuta la cadena real: PASS o SKIP explícito, jamás GO a ciegas", () => {
    const r = spawnSync("bash", ["supabase/tests/reparse_p06_runner.sh"], {
      encoding: "utf8",
      env: { ...process.env, P06_LOCAL_USER: process.env.P06_LOCAL_USER ?? "lovable" },
      timeout: 300_000,
    });
    const salida = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
    if (r.status === 3) {
      // eslint-disable-next-line no-console
      console.warn("SKIP / NO VERIFICADO (P0.6): sin PostgreSQL local.\n" + salida.slice(-500));
      expect(salida).toContain("SKIP / NO VERIFICADO");
      return;
    }
    expect(`${r.status}`).toBe("0");
    expect(salida).toContain("PASS · P0.6 verificado contra PostgreSQL efímero real");
  }, 320_000);
});

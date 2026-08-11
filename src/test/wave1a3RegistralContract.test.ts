import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const SQL_1A2 = "supabase/pending_migrations/20260810164500_wave1a_registral_rebuild_seguro.sql";
const SQL_1A3 = "supabase/pending_migrations/20260812000000_wave1a3_registral_forward.sql";
const FIXTURES = "supabase/tests/wave1a3_fixtures.sql";
const RUNNER = "supabase/tests/wave1a3_integration_runner.sh";

/** Devuelve los alias de columna, en orden, del SELECT final `... FROM e;`. */
function finalViewColumns(sql: string): string[] {
  const end = sql.lastIndexOf("FROM e;");
  expect(end).toBeGreaterThan(0);
  const head = sql.slice(0, end);
  const start = head.lastIndexOf("\nSELECT\n");
  expect(start).toBeGreaterThan(0);
  const body = head
    .slice(start + "\nSELECT\n".length)
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  const items: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  items.push(buf);

  return items
    .map((raw) => raw.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((item) => {
      const as = item.match(/\bAS\s+([a-z_][a-z0-9_]*)$/i);
      if (as) return as[1].toLowerCase();
      const bare = item.match(/([a-z_][a-z0-9_]*)$/i);
      expect(bare, `no se pudo resolver el alias de: ${item}`).toBeTruthy();
      return bare![1].toLowerCase();
    });
}

/** Nombres declarados en el validador de contrato embebido en la 1A.3. */
function declaredContract(sql: string): string[] {
  const block = sql.slice(sql.indexOf("v_esperado text[] := ARRAY["));
  const arr = block.slice(block.indexOf("["), block.indexOf("];") + 1);
  return [...arr.matchAll(/'([a-z_]+):[a-z ]+'/g)].map((m) => m[1]);
}

describe("Wave 1A.3 · contrato de firma de v_p0_rights_staging", () => {
  const cols12 = finalViewColumns(R(SQL_1A2));
  const cols13 = finalViewColumns(R(SQL_1A3));
  const declared = declaredContract(R(SQL_1A3));

  it("1A.2 expone exactamente 39 columnas y termina en feeds_cuota", () => {
    expect(cols12).toHaveLength(39);
    expect(cols12[0]).toBe("titular_id");
    expect(cols12.at(-1)).toBe("feeds_cuota");
  });

  it("1A.3 conserva nombre y ORDEN de todas las columnas de 1A.2", () => {
    expect(cols13.slice(0, cols12.length)).toEqual(cols12);
  });

  it("las columnas nuevas de 1A.3 van SOLO al final y no duplican nombres", () => {
    const nuevas = cols13.slice(cols12.length);
    expect(nuevas.length).toBeGreaterThan(0);
    expect(new Set(cols13).size).toBe(cols13.length);
    for (const c of nuevas) expect(cols12).not.toContain(c);
  });

  it("el validador SQL embebido declara la firma real de 1A.2", () => {
    expect(declared).toEqual(cols12);
  });

  it("el validador SQL falla en caliente si la firma se desplaza", () => {
    const sql = R(SQL_1A3);
    expect(sql).toContain("CONTRATO 1A.2 ROTO en la posición");
    expect(sql).toMatch(/RAISE EXCEPTION[\s\S]{0,400}CONTRATO 1A\.2 ROTO/);
  });
});

describe("Wave 1A.3 · seguridad de unidad completa", () => {
  const sql = R(SQL_1A3);

  it("feeds_cuota exige fila, capa Y unidad completas", () => {
    expect(sql).toContain("(e.row_safe_pre_layer AND e.layer_safe AND e.unidad_segura) AS feeds_cuota");
  });

  it("layer_safe nunca se calcula sólo dentro de pleno_dominio", () => {
    expect(sql).toContain("coalesce(k.layer_safe, false) AND coalesce(ue.unidad_segura, false)");
  });

  it("unidad_segura exige que TODA fila canónica sea pleno operativo y no problemática", () => {
    expect(sql).toContain(
      "bool_and(NOT fila_problematica AND right_type = 'pleno_dominio') AS unidad_segura",
    );
  });

  it("la fila problemática cubre conflictos, evidencia insegura y no-match", () => {
    for (const señal of [
      "b.role_conflict",
      "b.regime_conflict",
      "b.unidad_key_conflict",
      "b.identity_conflict",
      "b.building_block",
      "b.right_type = 'otro'",
      "b.invalid_pct",
      "b.identidad_ambigua",
      "b.es_sociedad",
      "b.unidad_con_lista_sin_titulares",
    ]) {
      expect(sql).toContain(señal);
    }
  });
});

describe("Wave 1A.3 · tests incapaces de tocar producción", () => {
  const fixtures = R(FIXTURES);
  const runner = R(RUNNER);

  it("las fixtures no contienen COMMIT y siempre terminan en ROLLBACK", () => {
    expect(fixtures).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(fixtures).toMatch(/^\s*ROLLBACK\s*;/im);
    expect(fixtures.indexOf("BEGIN;")).toBeGreaterThan(0);
  });

  it("las fixtures abortan fuera de una base desechable", () => {
    expect(fixtures).toContain("current_database() NOT LIKE 'wave1a\\_test\\_%'");
  });

  it("el runner rechaza destinos remotos y bases arbitrarias", () => {
    expect(runner).toContain("no es loopback");
    expect(runner).toContain("SUPABASE_DB_URL");
    expect(runner).toContain("unset PGDATABASE");
    expect(runner).toContain('TESTDB="wave1a_test_${SUFIJO}"');
    expect(runner).toContain("trap cleanup EXIT");
    expect(runner).toContain("El rol dedicado no puede ser 'postgres'");
  });

  it("el runner verifica que las fixtures no puedan confirmar", () => {
    expect(runner).toContain("las fixtures deben terminar en ROLLBACK");
  });
});

describe("Wave 1A.3 · rebuild real sigue deshabilitado", () => {
  it("p_apply = true lanza excepción", () => {
    const sql = R(SQL_1A3);
    expect(sql).toMatch(/p_apply/);
    expect(sql).toMatch(/RAISE EXCEPTION[^;]*p_apply/i);
  });
});

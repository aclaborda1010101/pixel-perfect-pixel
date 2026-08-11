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
  const terminador = [...sql.matchAll(/\nFROM +(?:[a-z_]+ +)?e;/g)].pop();
  expect(terminador, "no se encontró el SELECT final de la vista").toBeTruthy();
  const end = terminador!.index!;
  const head = sql.slice(0, end);
  const start = head.lastIndexOf("\nSELECT\n");
  expect(start).toBeGreaterThan(0);
  const body = head
    .slice(start + "\nSELECT\n".length)
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  // Enmascara los literales de texto: los paréntesis y comas que viven
  // dentro de una cadena no son estructura del SELECT.
  let dentro = false;
  const masked = [...body]
    .map((ch) => {
      if (ch === "'") {
        dentro = !dentro;
        return "'";
      }
      return dentro ? "x" : ch;
    })
    .join("");

  const items: string[] = [];
  let depth = 0;
  let inicio = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      items.push(body.slice(inicio, i));
      inicio = i + 1;
      continue;
    }
  }
  items.push(body.slice(inicio));

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
    // Clúster efímero sin red: ninguna conexión externa puede influir.
    expect(runner).toContain("SUPABASE_DB_URL");
    expect(runner).toContain("no acepta destinos externos");
    expect(runner).toContain("unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD");
    expect(runner).toContain("listen_addresses=''");
    expect(runner).toContain('TESTDB="wave1a_test_${RAND}"');
    expect(runner).toContain("trap cleanup EXIT");
    expect(runner).toContain("el rol de pruebas no puede ser superusuario");
  });

  it("el runner verifica que las fixtures no puedan confirmar", () => {
    expect(runner).toContain("las fixtures deben terminar en ROLLBACK");
  });
});

describe("Wave 1A.3 · rebuild real sigue deshabilitado", () => {
  it("p_apply = true lanza excepción", () => {
    const sql = R(SQL_1A3);
    expect(sql).toMatch(/IF p_apply THEN[\s\S]{0,160}RAISE EXCEPTION/);
    expect(sql).toContain("REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL");
  });
});

describe("Wave 1A.3 P0.3 · namespaces, vínculo, parseo total y atomicidad", () => {
  const sql = R(SQL_1A3);
  const runner = R(RUNNER);
  const fixtures = R(FIXTURES);
  const puros = R("supabase/tests/wave1a3_pure_cases.sql");

  it("los identificadores de unidad viven en namespaces separados", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.p0_nota_unit_locators(");
    // El conflicto se calcula agrupando POR TIPO: nunca comparando literales
    // de namespaces distintos.
    expect(sql).toMatch(
      /p0_nota_unit_key_conflict[\s\S]{0,900}count\(DISTINCT l ->> 'clave'\)[\s\S]{0,200}GROUP BY \(l ->> 'tipo'\)/,
    );
    expect(sql).toContain("prioridad', 'idufir>finca>refcat'");
    expect(sql).toContain("'unit_aliases', s.unit_aliases");
  });

  it("alias cross-type no demostrable bloquea en lugar de comparar literales", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.p0_nota_unit_cross_type_unverified(");
    expect(sql).toMatch(/count\(DISTINCT l ->> 'tipo'\) > 1 AND count\(DISTINCT l ->> 'nodo'\) > 1/);
    expect(sql).toContain("WHEN e.cross_type_unverified THEN 'cross_type_unverified'");
  });

  it("el vínculo de evidencia exige un único elemento y es auditable", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.p0_locator_link_diag(");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.p0_sj_triple_nodos(");
    // Triple repetida en dos nodos => ambiguo, nunca feed.
    expect(sql).toMatch(/IF v_ruta_ok AND v_triple > 1 THEN[\s\S]{0,120}v_ambiguo := true;/);
    // evidence_ref guarda cada localizador por separado, sin coalesce.
    for (const clave of ["'pagina',", "'offset',", "'ruta_declarada',", "'locator',"]) {
      expect(sql).toContain(clave);
    }
    expect(sql).toContain("'nodo_resuelto'");
  });

  it("el parseo de localizadores no puede lanzar", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.p0_safe_int(");
    expect(sql).toMatch(/IF s !~ '\^\[0-9\]\{1,12\}\$' THEN RETURN NULL; END IF;/);
    expect(sql).toMatch(/IF char_length\(p_txt\) > 64 THEN RETURN NULL; END IF;/);
    expect(sql).toMatch(/IF v < 0 OR v > 2147483647 THEN RETURN NULL; END IF;/);
    expect(sql).toContain("EXCEPTION WHEN others THEN\n  RETURN NULL;");
    // Nadie castea texto libre a integer directamente en los localizadores.
    expect(sql).not.toMatch(/p_offset\)::int/);
    expect(sql).not.toMatch(/p_pagina\)::int/);
    expect(puros).toContain("public.p0_safe_int('1e3') IS NULL");
    expect(puros).toContain("repeat('x', 100000)");
  });

  it("la migración pendiente es atómica", () => {
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });

  it("el runner no usa shims ni omite migraciones", () => {
    expect(runner).not.toMatch(/SHIM +[0-9a-f]/);
    expect(runner).not.toMatch(/CREATE EXTENSION\[\^;\]/);
    expect(runner).not.toContain("SKIP_LOCAL");
    expect(runner).not.toContain("asegurar_placeholder");
    expect(runner).not.toMatch(/sed -E "s@\(CREATE EXTENSION/);
    expect(runner).not.toMatch(/>\/dev\/null 2>&1 \|\| true/);
    // Extensiones reales o SKIP explícito, sin declarar aplicabilidad.
    expect(runner).toContain("REQ_EXT");
    expect(runner).toContain("no se pudieron crear las extensiones reales declaradas por el snapshot.");
    expect(runner).toContain("NO se declara aplicabilidad");
    expect(runner).toContain("wave1a3_snapshot_pre_1a2.sql");
    expect(runner).toContain("sha256sum -c");
    expect(runner).toContain("SENTINEL: WAVE1A3_P04_PASS");
    expect(runner).toContain("SENTINEL: WAVE1A3_P04_NO_GO");
    expect(runner).toContain("SENTINEL: WAVE1A3_P04_NO_VERIFICADO");
  });

  it("las fixtures cubren identidad de unidad y vínculo de evidencia", () => {
    expect(fixtures).toContain("alias compatibles");
    expect(fixtures).toContain("dos IDUFIR distintos => unit_key_conflict");
    expect(fixtures).toContain("cross_type_unverified, bloqueo");
    expect(fixtures).toContain("misma triple en dos nodos");
    expect(fixtures).toContain("página válida + ruta que no resuelve => cero feed");
    expect(fixtures).toContain("vínculo positivo y auditable");
    // feeds=3 sigue siendo exclusivo de los positivos.
    expect(fixtures).toContain("solo alimentan las 3 filas seguras de los casos positivos");
  });
});

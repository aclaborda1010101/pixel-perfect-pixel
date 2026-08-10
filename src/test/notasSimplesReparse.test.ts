import { describe, it, expect } from "vitest";
import {
  normalizeRol,
  normalizeTitular,
  normalizePorcentaje,
  logicalRightKey,
  sanitize,
  sanitizeDeep,
  type TitularNormalizado,
} from "../../supabase/functions/notas_simples_reparse/lib";
import {
  normalizePorcentajeChecked,
  normalizeTitularChecked,
  normalizeTitularesChecked,
  trySanitizeDeep,
  buildEvidencia,
} from "../../supabase/functions/notas_simples_reparse/lib";
import {
  buildReconcilePlan,
  summarizeBatch,
  needsTitularesRefetch,
  dedupeDeseados,
  mergeEvidencia,
  runReconciliation,
  type ReconcileRepo,
  type OpResult,
  type FilaExistente,
} from "../../supabase/functions/notas_simples_reparse/reconcile";

describe("rol y literal", () => {
  it("desconocido/vacío -> otro, nunca pleno", () => {
    for (const v of ["", "  ", null, undefined, "titular registral", "xyz", 42, {}]) {
      expect(normalizeRol(v as unknown)).toBe("otro");
    }
  });
  it("distingue los cinco roles", () => {
    expect(normalizeRol("pleno dominio")).toBe("pleno");
    expect(normalizeRol("nuda propiedad")).toBe("nuda_propiedad");
    expect(normalizeRol("usufructo vitalicio")).toBe("usufructo");
    expect(normalizeRol("Sociedad de gananciales")).toBe("ganancial");
    expect(normalizeRol("concesión administrativa")).toBe("otro");
  });
  it("no inventa rol_literal copiando t.rol", () => {
    const t = normalizeTitular({ nombre: "ACME S.L.", rol: "concesión administrativa" })!;
    expect(t.rol).toBe("otro");
    expect(t.rol_literal).toBeNull();
  });
  it("el literal manda sobre un rol contradictorio y registra el conflicto", () => {
    const t = normalizeTitular({ nombre: "Ana", rol: "pleno", rol_literal: "Sociedad de gananciales" })!;
    expect(t.rol).toBe("ganancial");
    expect(t.evidencia?.normalizacion).toEqual({
      raw_rol: "pleno",
      raw_literal: "Sociedad de gananciales",
      role_conflict: true,
    });
  });
  it("sin conflicto no añade bloque de normalización", () => {
    const t = normalizeTitular({ nombre: "Ana", rol: "usufructo", rol_literal: "usufructo vitalicio" })!;
    expect(t.evidencia).toBeNull();
  });
  it("no inventa evidencia y descarta titulares sin nombre", () => {
    expect(normalizeTitular({ nombre: "Ana" })!.evidencia).toBeNull();
    expect(normalizeTitular({ nombre: " " })).toBeNull();
  });
});

describe("porcentaje seguro", () => {
  it("fracciones inequívocas", () => {
    expect(normalizePorcentaje("1/2")).toBe(50);
    expect(normalizePorcentaje("50/100")).toBe(50);
    expect(normalizePorcentaje("1/0")).toBeNull();
  });
  it("decimales, coma y símbolo", () => {
    expect(normalizePorcentaje("50,00%")).toBe(50);
    expect(normalizePorcentaje("33,5")).toBe(33.5);
    expect(normalizePorcentaje(100)).toBe(100);
    expect(normalizePorcentaje("33,333")).toBe(33.33);
  });
  it("rechaza cero, negativos, >100 y texto", () => {
    for (const v of [0, -1, 101, "abc", "1/2/3", "cincuenta", "", null, undefined, {}]) {
      expect(normalizePorcentaje(v as unknown)).toBeNull();
    }
  });
});

describe("sanitización", () => {
  it("NUL, controles, emoji válido y surrogate huérfano", () => {
    expect(sanitize("Peñ\u0000a Ñ\u0007ó ü — 石")).toBe("Peñ a Ñ ó ü — 石");
    expect(sanitize("hola 😀")).toBe("hola 😀");
    expect(sanitize("x\uD83Dy")).toBe("x\uFFFDy");
    expect(sanitize("línea\nuno\ttab")).toBe("línea\nuno\ttab");
  });
  it("bloquea __proto__, prototype y constructor", () => {
    const raw = JSON.parse('{"a":"x","__proto__":{"polluted":1},"prototype":{"b":2},"constructor":{"c":3}}');
    const out = sanitizeDeep(raw) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["a"]);
    expect(JSON.stringify(out)).toBe('{"a":"x"}');
    expect(({} as any).polluted).toBeUndefined();
  });
  it("sanea recursivamente", () => {
    expect(sanitizeDeep({ a: "x\u0000y", b: [{ c: "ñ\u001Fz" }], n: 3, z: null }))
      .toEqual({ a: "x y", b: [{ c: "ñ z" }], n: 3, z: null });
  });
});

describe("identidad lógica", () => {
  it("no colapsa nuda propiedad y usufructo", () => {
    expect(logicalRightKey({ nombre: "María", cif_dni: "1Z", porcentaje: 50, rol: "nuda_propiedad" }))
      .not.toBe(logicalRightKey({ nombre: "María", cif_dni: "1Z", porcentaje: 50, rol: "usufructo" }));
  });
  it("dos derechos 'otro' con literales distintos no colapsan", () => {
    const a = normalizeTitular({ nombre: "ACME", cif_dni: "B1", porcentaje: 50, rol_literal: "concesión administrativa" })!;
    const b = normalizeTitular({ nombre: "ACME", cif_dni: "B1", porcentaje: 50, rol_literal: "derecho de superficie" })!;
    expect(a.rol).toBe("otro");
    expect(b.rol).toBe("otro");
    expect(logicalRightKey(a)).not.toBe(logicalRightKey(b));
  });
});

const fila = (o: Partial<FilaExistente> & { id: string }): FilaExistente => ({
  nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: null, evidencia: null, ...o,
});

describe("plan de conciliación", () => {
  it("evidencia nueva genera UPDATE, no INSERT", () => {
    const d = normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol_literal: "pleno dominio", evidencia: { cita: "URBANA…", pagina: 2 } })!;
    const existentes = [fila({ id: "r1", rol_literal: "pleno dominio" })];
    const plan = buildReconcilePlan(existentes, [d]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "r1", patch: { evidencia: { cita: "URBANA…", pagina: 2 } } }]);
  });

  it("fila vieja pleno + literal ganancial se corrige por fallback único", () => {
    const d = normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "Sociedad de gananciales" })!;
    const plan = buildReconcilePlan([fila({ id: "r1" })], [d]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates[0].id).toBe("r1");
    expect(plan.updates[0].patch.rol).toBe("ganancial");
    expect(plan.updates[0].patch.rol_literal).toBe("Sociedad de gananciales");
  });

  it("fallback ambiguo bloquea el plan", () => {
    const d = normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol_literal: "usufructo vitalicio" })!;
    // dos filas legadas (sin rol_literal) con rol distinto: no son duplicado lógico,
    // pero ambas son candidatas por identidad base -> ambigüedad.
    const plan = buildReconcilePlan([fila({ id: "r1", rol: "pleno" }), fila({ id: "r2", rol: "otro" })], [d]);
    expect(plan.ok).toBe(false);
    expect((plan as any).reason).toBe("titular_reconcile_ambiguous");
    expect(plan.updates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(0);
  });

  it("derecho realmente nuevo se inserta", () => {
    const d = normalizeTitular({ nombre: "Luis Soto", cif_dni: "99", porcentaje: 25, rol_literal: "usufructo vitalicio" })!;
    const plan = buildReconcilePlan([fila({ id: "r1", rol_literal: "pleno dominio" })], [d]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
  });

  it("aplicar el plan dos veces converge sin nuevas inserciones", () => {
    const deseados = [
      normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "Sociedad de gananciales", evidencia: { cita: "TOMO 1" } })!,
      normalizeTitular({ nombre: "Luis Soto", cif_dni: "99", porcentaje: 50, rol_literal: "usufructo vitalicio" })!,
    ] as TitularNormalizado[];
    let filas: FilaExistente[] = [fila({ id: "r1" })];
    const aplicar = (plan: ReturnType<typeof buildReconcilePlan>) => {
      if (!plan.ok) throw new Error("plan bloqueado");
      filas = filas.map((f) => {
        const u = plan.updates.find((x) => x.id === f.id);
        return u ? { ...f, ...u.patch } : f;
      });
      plan.inserts.forEach((t, i) => filas.push({
        id: `new${filas.length + i}`, nombre_extraido: t.nombre, cif_dni: t.cif_dni,
        porcentaje: t.porcentaje, rol: t.rol, rol_literal: t.rol_literal, evidencia: t.evidencia,
      }));
      return plan;
    };
    const p1 = aplicar(buildReconcilePlan(filas, deseados));
    expect(p1.inserts).toHaveLength(1);
    expect(filas).toHaveLength(2);
    const p2 = aplicar(buildReconcilePlan(filas, deseados));
    expect(p2.inserts).toHaveLength(0);
    expect(p2.updates).toHaveLength(0);
    expect(filas).toHaveLength(2);
  });
});

describe("semántica de respuesta", () => {
  it("lote completo -> 200/ok", () => {
    expect(summarizeBatch(3, 3)).toEqual({ ok: true, status: "ok", http: 200, records_upserted: 3, records_failed: 0, error_message: null, partial: false });
  });
  it("parcial -> HTTP 500, status partial, ok=false, partial=true", () => {
    const r = summarizeBatch(3, 2, ["n1:llm_fail"]);
    expect([r.ok, r.status, r.http, r.records_failed, r.partial]).toEqual([false, "partial", 500, 1, true]);
    expect(r.error_message).toContain("llm_fail");
  });
  it("cero éxitos -> 500/error/ok=false", () => {
    const r = summarizeBatch(2, 0, ["a", "b"]);
    expect([r.ok, r.status, r.http, r.records_upserted, r.records_failed]).toEqual([false, "error", 500, 0, 2]);
  });
  it("ningún resultado 2xx si hay algún fallo", () => {
    for (const [t, c] of [[3, 2], [5, 4], [2, 1], [10, 9]] as const) {
      expect(summarizeBatch(t, c, ["x"]).http).toBe(500);
    }
  });
});

describe("reextracción", () => {
  it("pide titulares si faltan, si falta literal/evidencia o si la versión es antigua", () => {
    expect(needsTitularesRefetch({ titulares: [] })).toBe(true);
    expect(needsTitularesRefetch({ titulares: [{ rol_literal: "x", evidencia: { cita: "y" } }] })).toBe(true); // v<2
    expect(needsTitularesRefetch({ reparse_schema_version: 2, titulares: [{ rol_literal: null, evidencia: { cita: "y" } }] })).toBe(true);
    expect(needsTitularesRefetch({ reparse_schema_version: 2, titulares: [{ rol_literal: "x", evidencia: null }] })).toBe(true);
    expect(needsTitularesRefetch({ reparse_schema_version: 2, titulares: [{ rol_literal: "x", evidencia: { cita: "y" } }] })).toBe(false);
  });
});

// ---------------- validación chequeada ----------------

describe("validación de titulares", () => {
  it("porcentaje ausente permitido; no vacío inválido bloquea", () => {
    expect(normalizePorcentajeChecked(null)).toEqual({ ok: true, value: null });
    expect(normalizePorcentajeChecked("")).toEqual({ ok: true, value: null });
    expect(normalizePorcentajeChecked("   ")).toEqual({ ok: true, value: null });
    expect(normalizePorcentajeChecked("50")).toEqual({ ok: true, value: 50 });
    for (const v of ["abc", 0, -5, 101, "1/0", "1/2/3"]) {
      const r = normalizePorcentajeChecked(v as unknown);
      expect(r.ok).toBe(false);
      expect((r as any).reason).toBe("porcentaje_invalido");
    }
  });
  it("titular sin nombre bloquea; titular con porcentaje inválido bloquea", () => {
    expect((normalizeTitularChecked({ nombre: " " }) as any).reason).toBe("titular_sin_nombre");
    expect((normalizeTitularChecked({ nombre: "Ana", porcentaje: "mitad" }) as any).reason).toBe("porcentaje_invalido");
    expect(normalizeTitularChecked({ nombre: "Ana", porcentaje: null }).ok).toBe(true);
  });
  it("fuente vacía o titular inválido -> error de lista completa", () => {
    expect((normalizeTitularesChecked([]) as any).reason).toBe("titulares_source_empty");
    expect((normalizeTitularesChecked(null) as any).reason).toBe("titulares_source_empty");
    expect((normalizeTitularesChecked([{ nombre: "Ana" }, { nombre: "" }]) as any).reason).toBe("titular_sin_nombre");
    const ok = normalizeTitularesChecked([{ nombre: "Ana" }, { nombre: "Luis" }]);
    expect(ok.ok).toBe(true);
    expect((ok as any).value).toHaveLength(2);
  });
});

describe("sanitización avanzada", () => {
  it("elimina controles C1 y preserva tab/LF/CR", () => {
    expect(sanitize("a\u0085b\u009Fc")).toBe("a b c");
    expect(sanitize("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
  it("normaliza a NFC", () => {
    const nfd = "Pen\u0303a";
    expect(sanitize(nfd)).toBe("Peña");
    expect(sanitize(nfd).length).toBe(4);
  });
  it("profundidad excesiva -> fallo controlado, no recursión ilimitada", () => {
    let deep: any = "hoja";
    for (let i = 0; i < 40; i++) deep = { n: deep };
    const r = trySanitizeDeep(deep);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("sanitize_depth_exceeded");
    const shallow = trySanitizeDeep({ a: { b: { c: "x\u0000y" } } });
    expect(shallow.ok).toBe(true);
    expect((shallow as any).value).toEqual({ a: { b: { c: "x y" } } });
  });
  it("evidencia: objeto no-array, página entera positiva, cadenas vacías fuera", () => {
    expect(buildEvidencia({ evidencia: ["cita"] })).toBeNull();
    expect(buildEvidencia({ evidencia: { cita: "   ", ruta: "" } })).toBeNull();
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: 0 } })).toEqual({ cita: "URBANA" });
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: 2.5 } })).toEqual({ cita: "URBANA" });
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: -3 } })).toEqual({ cita: "URBANA" });
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: "3" } })).toEqual({ cita: "URBANA", pagina: 3 });
    expect(buildEvidencia({})).toBeNull();
  });
});

// ---------------- duplicados del propio modelo ----------------

const tit = (o: any): TitularNormalizado => normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol_literal: "pleno dominio", ...o })!;

describe("duplicados del propio modelo", () => {
  it("dos deseados idénticos producen una sola operación", () => {
    const d = tit({});
    const ded = dedupeDeseados([d, { ...d }]);
    expect((ded as any).value).toHaveLength(1);
    const plan = buildReconcilePlan([], [d, { ...d }]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });
  it("evidencia compatible se fusiona", () => {
    const a = tit({ evidencia: { cita: "URBANA" } });
    const b = tit({ evidencia: { pagina: 2 } });
    const ded = dedupeDeseados([a, b]) as any;
    expect(ded.ok).toBe(true);
    expect(ded.value).toHaveLength(1);
    expect(ded.value[0].evidencia).toEqual({ cita: "URBANA", pagina: 2 });
    expect(mergeEvidencia(null, { cita: "x" })).toEqual({ ok: true, value: { cita: "x" } });
  });
  it("evidencia contradictoria bloquea antes de escribir", () => {
    const a = tit({ evidencia: { cita: "URBANA A", pagina: 1 } });
    const b = tit({ evidencia: { cita: "URBANA B", pagina: 1 } });
    const plan = buildReconcilePlan([], [a, b]);
    expect(plan.ok).toBe(false);
    expect((plan as any).reason).toBe("duplicate_desired_conflicting_evidence");
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
  });
  it("dos existentes lógicamente iguales bloquean", () => {
    const existentes: FilaExistente[] = [
      { id: "r1", nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "pleno dominio" },
      { id: "r2", nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "pleno dominio" },
    ];
    const plan = buildReconcilePlan(existentes, [tit({})]);
    expect(plan.ok).toBe(false);
    expect((plan as any).reason).toBe("existing_logical_duplicate");
  });
});

// ---------------- flujo con repositorio verificable ----------------

type Registro = { op: string; arg?: unknown };

function repoFalso(overrides: Partial<Record<"update" | "insert" | "backfill" | "finalize", (n: number) => OpResult>> = {}, opts: { conBackfill?: boolean } = {}) {
  const log: Registro[] = [];
  let updates = 0, inserts = 0, backfills = 0, finalizes = 0;
  const repo: ReconcileRepo = {
    async updateTitular(id, patch) {
      updates++; log.push({ op: "update", arg: id });
      return overrides.update ? overrides.update(updates) : { rows: 1 };
    },
    async insertTitular(row) {
      inserts++; log.push({ op: "insert", arg: row.nombre_extraido });
      return overrides.insert ? overrides.insert(inserts) : { rows: 1 };
    },
    async finalizeNota() {
      finalizes++; log.push({ op: "finalize" });
      return overrides.finalize ? overrides.finalize(finalizes) : { rows: 1 };
    },
  };
  if (opts.conBackfill) {
    repo.backfill = async () => {
      backfills++; log.push({ op: "backfill" });
      return overrides.backfill ? overrides.backfill(backfills) : { rows: 1 };
    };
  }
  return { repo, log, conteo: () => ({ updates, inserts, backfills, finalizes }) };
}

const args = (deseados: TitularNormalizado[], existentes: FilaExistente[] = []) => ({
  notaId: "nota-1", claimToken: "2026-01-01T00:00:00.000Z", existentes, deseados,
});

describe("flujo de persistencia verificable", () => {
  it("éxito: finaliza una sola vez y siempre en último lugar", async () => {
    const f = repoFalso({}, { conBackfill: true });
    const r = await runReconciliation(f.repo, args([tit({}), tit({ nombre: "Luis Soto", cif_dni: "99" })]));
    expect(r.ok).toBe(true);
    expect([r.inserted, r.updated, r.finalized]).toEqual([2, 0, true]);
    expect(f.log.map((x) => x.op)).toEqual(["insert", "insert", "backfill", "finalize"]);
    expect(f.conteo().finalizes).toBe(1);
  });

  it("lista vacía / titular inválido: cero escrituras y sin finalización", async () => {
    const f = repoFalso();
    const norm = normalizeTitularesChecked([]);
    expect(norm.ok).toBe(false);
    const r = await runReconciliation(f.repo, args([tit({ evidencia: { cita: "A" } }), tit({ evidencia: { cita: "B" } })]));
    expect(r.ok).toBe(false);
    expect(r.finalized).toBe(false);
    expect(f.log).toHaveLength(0);
  });

  it("segundo insert falla: no hay finalización", async () => {
    const f = repoFalso({ insert: (n) => (n === 2 ? { rows: 0, error: "boom" } : { rows: 1 }) });
    const r = await runReconciliation(f.repo, args([tit({}), tit({ nombre: "Luis Soto", cif_dni: "99" })]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("titular_insert_fail");
    expect(r.inserted).toBe(1);
    expect(f.conteo().finalizes).toBe(0);
  });

  it("operación que devuelve 0 filas es fallo aunque no haya error", async () => {
    const f = repoFalso({ update: () => ({ rows: 0 }) });
    const existentes: FilaExistente[] = [{ id: "r1", nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "otro", rol_literal: null }];
    const r = await runReconciliation(f.repo, args([tit({})], existentes));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("titular_update_fail");
    expect(f.conteo().finalizes).toBe(0);
  });

  it("backfill falla: no hay finalización", async () => {
    const f = repoFalso({ backfill: () => ({ rows: 0, error: "backfill ko" }) }, { conBackfill: true });
    const r = await runReconciliation(f.repo, args([tit({})]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("backfill_fail");
    expect(f.conteo().finalizes).toBe(0);
  });

  it("claim perdido: cierre devuelve 0 filas -> fallo, nunca éxito", async () => {
    const f = repoFalso({ finalize: () => ({ rows: 0 }) });
    const r = await runReconciliation(f.repo, args([tit({})]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("claim_lost");
    expect(r.finalized).toBe(false);
  });

  it("error en el cierre -> finalize_fail", async () => {
    const f = repoFalso({ finalize: () => ({ rows: 1, error: "conflict" }) });
    const r = await runReconciliation(f.repo, args([tit({})]));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("finalize_fail");
  });

  it("el reintento converge: segunda pasada sin escrituras salvo el cierre", async () => {
    const deseados = [tit({ evidencia: { cita: "URBANA", pagina: 1 } })];
    const f1 = repoFalso();
    const r1 = await runReconciliation(f1.repo, args(deseados));
    expect(r1.inserted).toBe(1);
    const yaEnBase: FilaExistente[] = [{
      id: "r1", nombre_extraido: deseados[0].nombre, cif_dni: deseados[0].cif_dni,
      porcentaje: deseados[0].porcentaje, rol: deseados[0].rol,
      rol_literal: deseados[0].rol_literal, evidencia: deseados[0].evidencia,
    }];
    const f2 = repoFalso();
    const r2 = await runReconciliation(f2.repo, args(deseados, yaEnBase));
    expect(r2.ok).toBe(true);
    expect([r2.inserted, r2.updated]).toEqual([0, 0]);
    expect(f2.log.map((x) => x.op)).toEqual(["finalize"]);
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeRol,
  normalizeTitular,
  normalizeTitularChecked,
  normalizeTitularesChecked,
  normalizePorcentaje,
  normalizePorcentajeChecked,
  logicalRightKey,
  sanitize,
  sanitizeDeep,
  trySanitizeDeep,
  buildEvidencia,
  parseEvidencia,
  mergeEvidencias,
  hasRealEvidence,
  type TitularNormalizado,
} from "../../supabase/functions/notas_simples_reparse/lib";
import {
  buildReconcilePlan,
  summarizeBatch,
  needsTitularesRefetch,
  titularPersistidoEsFiable,
  dedupeDeseados,
  runReconciliation,
  type OpResult,
  type FilaExistente,
  type PatchTitular,
} from "../../supabase/functions/notas_simples_reparse/reconcile";
import {
  processNotaCore,
  decidirTitulares,
  decideMatching,
  decidePendingMatchOnDrain,
  decidePendingMatchOnDrainState,
  foldMatchPendingHistory,
  computeNextMatchPending,
  runMatching,
  type NotaRepo,
} from "../../supabase/functions/notas_simples_reparse/core";

// ---------------- rol y literal ----------------

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
  it("dos derechos específicos distintos BLOQUEAN con role_conflict", () => {
    const r = normalizeTitularChecked({ nombre: "Ana", rol: "pleno", rol_literal: "usufructo vitalicio" });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("role_conflict");
    expect((r as any).detalle).toContain("raw_rol=pleno");
    expect((r as any).detalle).toContain("raw_literal=usufructo vitalicio");
    const r2 = normalizeTitularChecked({ nombre: "Ana", rol: "nuda_propiedad", rol_literal: "pleno dominio" });
    expect((r2 as any).reason).toBe("role_conflict");
  });
  it("rol genérico/desconocido: el literal reconocible PREVALECE sin bloquear", () => {
    const a = normalizeTitular({ nombre: "Ana", rol: "otro", rol_literal: "usufructo vitalicio" })!;
    expect(a.rol).toBe("usufructo");
    const b = normalizeTitular({ nombre: "Ana", rol: "titular registral xyz", rol_literal: "nuda propiedad" })!;
    expect(b.rol).toBe("nuda_propiedad");
    const c = normalizeTitular({ nombre: "Ana", rol_literal: "usufructo" })!;
    expect(c.rol).toBe("usufructo");
    // el diagnóstico vive fuera de la evidencia
    expect(a.evidencia).toBeNull();
    expect(typeof a.rol_diagnostico === "string" || a.rol_diagnostico === null).toBe(true);
  });
  it("gananciales es régimen: nunca asciende a pleno ni bloquea", () => {
    const t = normalizeTitular({ nombre: "Ana", rol: "pleno", rol_literal: "Sociedad de gananciales" })!;
    expect(t.rol).toBe("pleno");
    const g = normalizeTitular({ nombre: "Ana", rol: "ganancial", rol_literal: "gananciales" })!;
    expect(g.rol).toBe("ganancial");
    const d = normalizeTitular({ nombre: "Ana", rol: "desconocido", rol_literal: "concesión" })!;
    expect(d.rol).toBe("otro");
  });
  it("sin conflicto no hay evidencia inventada", () => {
    const t = normalizeTitular({ nombre: "Ana", rol: "usufructo", rol_literal: "usufructo vitalicio" })!;
    expect(t.evidencia).toBeNull();
    expect(normalizeTitular({ nombre: " " })).toBeNull();
  });
});

// ---------------- porcentaje y sanitización ----------------

describe("porcentaje seguro", () => {
  it("fracciones, decimales y rechazos", () => {
    expect(normalizePorcentaje("1/2")).toBe(50);
    expect(normalizePorcentaje("50/100")).toBe(50);
    expect(normalizePorcentaje("1/0")).toBeNull();
    expect(normalizePorcentaje("50,00%")).toBe(50);
    expect(normalizePorcentaje("33,333")).toBe(33.33);
    for (const v of [0, -1, 101, "abc", "1/2/3", "cincuenta", "", null, undefined, {}]) {
      expect(normalizePorcentaje(v as unknown)).toBeNull();
    }
  });
  it("ausente ok / no vacío inválido bloquea", () => {
    expect(normalizePorcentajeChecked(null)).toEqual({ ok: true, value: null });
    expect(normalizePorcentajeChecked("   ")).toEqual({ ok: true, value: null });
    expect((normalizePorcentajeChecked("abc") as any).reason).toBe("porcentaje_invalido");
  });
});

describe("sanitización", () => {
  it("controles, surrogates y NFC", () => {
    expect(sanitize("Peñ\u0000a Ñ\u0007ó ü — 石")).toBe("Peñ a Ñ ó ü — 石");
    expect(sanitize("x\uD83Dy")).toBe("x\uFFFDy");
    expect(sanitize("a\tb\nc\rd")).toBe("a\tb\nc\rd");
    expect(sanitize("Pen\u0303a")).toBe("Peña");
  });
  it("bloquea __proto__/prototype/constructor y sanea en profundidad", () => {
    const raw = JSON.parse('{"a":"x","__proto__":{"polluted":1},"prototype":{"b":2},"constructor":{"c":3}}');
    expect(Object.keys(sanitizeDeep(raw) as Record<string, unknown>)).toEqual(["a"]);
    expect(({} as any).polluted).toBeUndefined();
    let deep: any = "hoja";
    for (let i = 0; i < 40; i++) deep = { n: deep };
    expect((trySanitizeDeep(deep) as any).reason).toBe("sanitize_depth_exceeded");
  });
});

// ---------------- evidencia canónica ----------------

describe("evidencia canónica", () => {
  it("acepta legado plano y forma canónica sin perder fuentes", () => {
    expect(parseEvidencia({ cita: "URBANA", pagina: 1 })).toEqual({ fuentes: [{ cita: "URBANA", pagina: 1 }] });
    expect(parseEvidencia({ fuentes: [{ ruta: "TOMO 3" }] })).toEqual({ fuentes: [{ ruta: "TOMO 3" }] });
    expect(parseEvidencia({ normalizacion: { role_conflict: true } })).toBeNull();
  });
  it("localizadores inválidos se descartan", () => {
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: 0 } })).toEqual({ fuentes: [{ cita: "URBANA" }] });
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: 2.5 } })).toEqual({ fuentes: [{ cita: "URBANA" }] });
    expect(buildEvidencia({ evidencia: { cita: "URBANA", pagina: "3" } })).toEqual({ fuentes: [{ cita: "URBANA", pagina: 3 }] });
    expect(buildEvidencia({ evidencia: { cita: "  ", ruta: "" } })).toBeNull();
    expect(buildEvidencia({})).toBeNull();
  });
  it("fusiona sin pérdida y conserva citas distintas del mismo localizador", () => {
    const m = mergeEvidencias({ cita: "A", pagina: 1 }, { ruta: "TOMO 3" });
    expect(m).toEqual({ ok: true, value: { fuentes: [{ cita: "A", pagina: 1 }, { ruta: "TOMO 3" }] } });
    const m2 = mergeEvidencias({ pagina: 1 }, { cita: "A", pagina: 1 });
    expect((m2 as any).value).toEqual({ fuentes: [{ pagina: 1, cita: "A" }] });
    // dos hechos registrales distintos en la misma página: se conservan ambos
    const dos = mergeEvidencias({ cita: "A", pagina: 1 }, { cita: "B", pagina: 1 });
    expect(dos.ok).toBe(true);
    expect((dos as any).value.fuentes).toEqual([{ cita: "A", pagina: 1 }, { cita: "B", pagina: 1 }]);
    // misma cita duplicada (aun con distinto formato) se coalesce en una
    const una = mergeEvidencias({ cita: "A", pagina: 1 }, { cita: " a ", pagina: 1 });
    expect((una as any).value.fuentes).toHaveLength(1);
    // existente A + deseada B conserva ambas, en orden estable e idempotente
    const existing = { fuentes: [{ cita: "A", pagina: 1 }] };
    const r1 = mergeEvidencias(existing, { cita: "B", pagina: 1 });
    const r2 = mergeEvidencias((r1 as any).value, { cita: "B", pagina: 1 });
    expect((r2 as any).value).toEqual((r1 as any).value);
    expect((r2 as any).value.fuentes.map((f: any) => f.cita)).toEqual(["A", "B"]);
  });
  it("hasRealEvidence exige fuente real con localizador válido", () => {
    expect(hasRealEvidence({ normalizacion: { raw_rol: "pleno", role_conflict: true } })).toBe(false);
    expect(hasRealEvidence({ cita: "URBANA" })).toBe(false);
    expect(hasRealEvidence({ cita: "URBANA", pagina: 2 })).toBe(true);
    expect(hasRealEvidence({ fuentes: [{ ruta: "SECCIÓN B" }] })).toBe(true);
    expect(hasRealEvidence({ fuentes: [{ offset: 0 }] })).toBe(true);
    expect(hasRealEvidence(null)).toBe(false);
    expect(hasRealEvidence({ foo: "bar" })).toBe(false);
  });
});

// ---------------- identidad lógica ----------------

describe("identidad lógica", () => {
  it("no colapsa derechos distintos", () => {
    expect(logicalRightKey({ nombre: "María", cif_dni: "1Z", porcentaje: 50, rol: "nuda_propiedad" }))
      .not.toBe(logicalRightKey({ nombre: "María", cif_dni: "1Z", porcentaje: 50, rol: "usufructo" }));
  });
  it("misma identidad jurídica con evidencias distintas es EL MISMO derecho", () => {
    const a = normalizeTitular({ nombre: "Ana", cif_dni: "1Z", porcentaje: 50, rol_literal: "pleno dominio", evidencia: { cita: "A", pagina: 1 } })!;
    const b = normalizeTitular({ nombre: "Ana", cif_dni: "1Z", porcentaje: 50, rol_literal: "pleno dominio", evidencia: { ruta: "TOMO" } })!;
    expect(logicalRightKey(a)).toBe(logicalRightKey(b));
  });
});

// ---------------- plan de conciliación ----------------

const fila = (o: Partial<FilaExistente> & { id: string }): FilaExistente => ({
  nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: null, evidencia: null, ...o,
});
const tit = (o: any): TitularNormalizado =>
  normalizeTitular({ nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol_literal: "pleno dominio", ...o })!;

describe("plan de conciliación", () => {
  it("coincidencia exacta fusiona evidencia existente + deseada (sin sobrescribir)", () => {
    const existentes = [fila({ id: "r1", rol_literal: "pleno dominio", evidencia: { cita: "A", pagina: 1 } })];
    const d = tit({ evidencia: { ruta: "TOMO 3" } });
    const plan = buildReconcilePlan(existentes, [d]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "r1", patch: { evidencia: { fuentes: [{ cita: "A", pagina: 1 }, { ruta: "TOMO 3" }] } } }]);
  });

  it("fallback legado también fusiona en vez de sobrescribir", () => {
    const existentes = [fila({ id: "r1", evidencia: { cita: "A", pagina: 1 } })];
    const d = tit({ rol_literal: "Sociedad de gananciales", evidencia: { pagina: 2, cita: "B" } });
    const plan = buildReconcilePlan(existentes, [d]) as any;
    expect(plan.ok).toBe(true);
    expect(plan.updates[0].patch.rol).toBe("ganancial");
    expect(plan.updates[0].patch.evidencia.fuentes).toEqual([{ cita: "A", pagina: 1 }, { pagina: 2, cita: "B" }]);
  });

  it("otra cita en la misma página se AÑADE a la fila existente (sin sobrescribir)", () => {
    const existentes = [fila({ id: "r1", rol_literal: "pleno dominio", evidencia: { cita: "A", pagina: 1 } })];
    const plan = buildReconcilePlan(existentes, [tit({ evidencia: { cita: "B", pagina: 1 } })]) as any;
    expect(plan.ok).toBe(true);
    expect(plan.updates[0].patch.evidencia.fuentes).toEqual([{ cita: "A", pagina: 1 }, { cita: "B", pagina: 1 }]);
    // idempotente: repetir la misma pasada no cambia el resultado
    const existentes2 = [fila({ id: "r1", rol_literal: "pleno dominio", evidencia: plan.updates[0].patch.evidencia })];
    const plan2 = buildReconcilePlan(existentes2, [tit({ evidencia: { cita: "B", pagina: 1 } })]) as any;
    expect(plan2.ok).toBe(true);
    expect(plan2.updates).toHaveLength(0);
  });

  it("dos deseados idénticos convergen en un derecho con unión de evidencias", () => {
    const a = tit({ evidencia: { cita: "URBANA", pagina: 1 } });
    const b = tit({ evidencia: { ruta: "SECCIÓN B" } });
    const ded = dedupeDeseados([a, b]) as any;
    expect(ded.value).toHaveLength(1);
    expect(ded.value[0].evidencia.fuentes).toHaveLength(2);
    const plan = buildReconcilePlan([], [a, b]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(1);
  });

  it("dos deseados con citas distintas en la misma página conservan ambas fuentes", () => {
    const plan = buildReconcilePlan([], [tit({ evidencia: { cita: "A", pagina: 1 } }), tit({ evidencia: { cita: "B", pagina: 1 } })]) as any;
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].evidencia.fuentes).toEqual([{ cita: "A", pagina: 1 }, { cita: "B", pagina: 1 }]);
    // la misma cita duplicada se coalesce en una sola fuente
    const dup = buildReconcilePlan([], [tit({ evidencia: { cita: "A", pagina: 1 } }), tit({ evidencia: { cita: "A", pagina: 1 } })]) as any;
    expect(dup.inserts[0].evidencia.fuentes).toHaveLength(1);
  });

  it("legado único frente a DOS derechos deseados bloquea, en cualquier orden", () => {
    const nuda = tit({ rol_literal: "nuda propiedad", evidencia: { cita: "N", pagina: 1 } });
    const usu = tit({ rol_literal: "usufructo vitalicio", evidencia: { cita: "U", pagina: 2 } });
    for (const deseados of [[nuda, usu], [usu, nuda]]) {
      const plan = buildReconcilePlan([fila({ id: "r1" })], deseados);
      expect(plan.ok).toBe(false);
      expect((plan as any).reason).toBe("legacy_one_to_many_ambiguous");
      expect(plan.updates).toHaveLength(0);
      expect(plan.inserts).toHaveLength(0);
    }
  });

  it("dos filas legadas para un deseado siguen siendo ambiguas", () => {
    const plan = buildReconcilePlan([fila({ id: "r1", rol: "pleno" }), fila({ id: "r2", rol: "otro" })], [tit({ rol_literal: "usufructo vitalicio" })]);
    expect((plan as any).reason).toBe("titular_reconcile_ambiguous");
  });

  it("dos existentes lógicamente iguales bloquean sin elegir arbitrariamente", () => {
    const existentes: FilaExistente[] = [
      { id: "r1", nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "pleno dominio" },
      { id: "r2", nombre_extraido: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno", rol_literal: "pleno dominio" },
    ];
    const plan = buildReconcilePlan(existentes, [tit({})]);
    expect((plan as any).reason).toBe("existing_logical_duplicate");
  });

  it("derecho realmente nuevo se inserta", () => {
    const plan = buildReconcilePlan([fila({ id: "r1", rol_literal: "pleno dominio" })], [tit({ nombre: "Luis Soto", cif_dni: "99", rol_literal: "usufructo vitalicio" })]);
    expect(plan.ok).toBe(true);
    expect(plan.inserts).toHaveLength(1);
  });

  it("deseados vacíos bloquean el plan", () => {
    const plan = buildReconcilePlan([fila({ id: "r1" })], []);
    expect(plan.ok).toBe(false);
    expect((plan as any).reason).toBe("deseados_vacios");
  });
});

// ---------------- semántica de respuesta y refetch ----------------

describe("semántica de respuesta", () => {
  it("completo 200, parcial 500/partial, total 500/error", () => {
    expect(summarizeBatch(3, 3).http).toBe(200);
    const p = summarizeBatch(3, 2, ["n1:llm_fail"]);
    expect([p.ok, p.status, p.http, p.partial]).toEqual([false, "partial", 500, true]);
    const e = summarizeBatch(2, 0, ["a"]);
    expect([e.ok, e.status, e.http]).toEqual([false, "error", 500]);
  });
});

describe("reextracción", () => {
  const v2 = (titulares: unknown[]) => ({ reparse_schema_version: 2, titulares });
  const fiable = (o: any = {}) => ({ nombre: "Ana", rol_literal: "pleno dominio", evidencia: { cita: "URBANA", pagina: 1 }, ...o });

  it("sin titulares o schema antiguo => refetch", () => {
    expect(needsTitularesRefetch({ titulares: [] })).toBe(true);
    expect(needsTitularesRefetch({ titulares: [fiable()] })).toBe(true); // v<2
    expect(needsTitularesRefetch({ reparse_schema_version: 1, titulares: [fiable()] })).toBe(true);
  });

  it("v2 NO basta: cita sola (sin localizador) sigue exigiendo refetch", () => {
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "URBANA" } })]))).toBe(true);
  });

  it("v2 + metadatos de normalización solos => refetch", () => {
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { normalizacion: { fuente: "llm" } } })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: {} })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { fuentes: [] } })]))).toBe(true);
  });

  it("v2 + localizador inválido (pagina 0, ruta vacía) => refetch", () => {
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "A", pagina: 0 } })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "A", ruta: "  " } })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "A", pagina: -3 } })]))).toBe(true);
  });

  it("v2 + nombre o rol_literal ausentes => refetch", () => {
    expect(needsTitularesRefetch(v2([fiable({ nombre: "  " })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ rol_literal: null })]))).toBe(true);
    expect(needsTitularesRefetch(v2([fiable({ rol_literal: "   " })]))).toBe(true);
  });

  it("v2 + evidencia real completa => sin refetch", () => {
    expect(needsTitularesRefetch(v2([fiable()]))).toBe(false);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "A", ruta: "SECCION B" } })]))).toBe(false);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { cita: "A", offset: 0 } })]))).toBe(false);
    expect(needsTitularesRefetch(v2([fiable({ evidencia: { fuentes: [{ cita: "A", pagina: 2 }] } })]))).toBe(false);
  });

  it("mezcla: un titular inseguro obliga a refetch de TODA la nota", () => {
    expect(needsTitularesRefetch(v2([fiable(), fiable({ nombre: "Luis", evidencia: { cita: "B" } })]))).toBe(true);
    expect(titularPersistidoEsFiable(fiable())).toBe(true);
    expect(titularPersistidoEsFiable({ nombre: "Ana", rol_literal: "pleno" })).toBe(false);
  });
});

describe("validación de titulares", () => {
  it("fuente vacía o titular inválido -> error de lista completa", () => {
    expect((normalizeTitularesChecked([]) as any).reason).toBe("titulares_source_empty");
    expect((normalizeTitularesChecked([{ nombre: "Ana" }, { nombre: "" }]) as any).reason).toBe("titular_sin_nombre");
    expect(normalizeTitularesChecked([{ nombre: "Ana" }]).ok).toBe(true);
  });
});

// ---------------- repositorio en memoria (mismo core que index) ----------------

type Registro = { op: string; arg?: unknown };

function repoMemoria(opts: {
  filas?: FilaExistente[];
  overrides?: Partial<Record<"update" | "insert" | "finalize", (n: number) => OpResult>>;
  readError?: string;
} = {}) {
  const log: Registro[] = [];
  const filas: FilaExistente[] = [...(opts.filas ?? [])];
  let updates = 0, inserts = 0, finalizes = 0;
  let seq = 0;
  const repo: NotaRepo = {
    async listTitulares() {
      log.push({ op: "list" });
      if (opts.readError) return { rows: [], error: opts.readError };
      return { rows: filas.map((f) => ({ ...f })) };
    },
    async updateTitular(id: string, patch: PatchTitular) {
      updates++; log.push({ op: "update", arg: id });
      const r = opts.overrides?.update ? opts.overrides.update(updates) : { rows: 1 };
      if (r.rows === 1 && !r.error) {
        const i = filas.findIndex((f) => f.id === id);
        if (i >= 0) filas[i] = { ...filas[i], ...patch } as FilaExistente;
      }
      return r;
    },
    async insertTitular(row) {
      inserts++; log.push({ op: "insert", arg: row.nombre_extraido });
      const r = opts.overrides?.insert ? opts.overrides.insert(inserts) : { rows: 1 };
      if (r.rows === 1 && !r.error) {
        filas.push({
          id: `mem${++seq}`, nombre_extraido: row.nombre_extraido, cif_dni: row.cif_dni,
          porcentaje: row.porcentaje, rol: row.rol, rol_literal: row.rol_literal, evidencia: row.evidencia,
        });
      }
      return r;
    },
    async finalizeNota() {
      finalizes++; log.push({ op: "finalize" });
      return opts.overrides?.finalize ? opts.overrides.finalize(finalizes) : { rows: 1 };
    },
  };
  return { repo, log, filas, conteo: () => ({ updates, inserts, finalizes }) };
}

const extractorDe = (data: any, model = "test/model") => async () => ({ data, model });
const escrituras = (log: Registro[]) => log.filter((x) => x.op !== "list");

const titularValido = (o: any = {}) => ({
  nombre: "Ana Pérez", cif_dni: "12345678Z", porcentaje: 50,
  rol_literal: "pleno dominio", evidencia: { cita: "URBANA", pagina: 1 }, ...o,
});

const argsNota = (structured: unknown = {}) => ({
  notaId: "nota-1", claimToken: "2026-01-01T00:00:00.000Z", structured,
});

describe("core: refetch estricto", () => {
  it("refetch requerido + LLM sin titulares => sin fallback, sin escrituras, sin finalize", async () => {
    const f = repoMemoria();
    const structured = { titulares: [titularValido()] }; // v<2 => needsRefetch
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ direccion: "X" }) }, argsNota(structured));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("titulares_refetch_vacio");
    expect(r.finalized).toBe(false);
    expect(f.log).toHaveLength(0);
  });

  it("titular nuevo sin rol_literal no finaliza", async () => {
    const f = repoMemoria();
    const r = await processNotaCore(
      { repo: f.repo, extract: extractorDe({ titulares: [titularValido({ rol_literal: null, rol: "pleno" })] }) },
      argsNota({}),
    );
    expect(r.reason).toBe("titular_sin_rol_literal");
    expect(escrituras(f.log)).toHaveLength(0);
  });

  it("titular nuevo sin evidencia real (solo cita, sin localizador) no finaliza", async () => {
    const f = repoMemoria();
    const r = await processNotaCore(
      { repo: f.repo, extract: extractorDe({ titulares: [titularValido({ evidencia: { cita: "URBANA" } })] }) },
      argsNota({}),
    );
    expect(r.reason).toBe("titular_sin_evidencia_real");
    expect(escrituras(f.log)).toHaveLength(0);
  });

  it("role_conflict bloquea antes de cualquier escritura", async () => {
    const f = repoMemoria();
    const r = await processNotaCore(
      { repo: f.repo, extract: extractorDe({ titulares: [titularValido({ rol: "pleno", rol_literal: "usufructo vitalicio" })] }) },
      argsNota({}),
    );
    expect(r.reason).toBe("role_conflict");
    expect(r.finalized).toBe(false);
    expect(f.log).toHaveLength(0);
  });

  it("sin refetch reconcilia los actuales; lista vacía jamás finaliza", async () => {
    const actual = titularValido();
    const structured = { reparse_schema_version: 2, titulares: [actual] };
    const ok = repoMemoria();
    const r1 = await processNotaCore({ repo: ok.repo, extract: extractorDe({ direccion: "X" }) }, argsNota(structured));
    expect(r1.ok).toBe(true);
    expect(r1.refetched).toBe(false);
    expect(r1.inserted).toBe(1);

    const vacio = repoMemoria();
    const decision = decidirTitulares({ needsRefetch: false, extraidos: [], actuales: [] });
    expect((decision as any).reason).toBe("titulares_source_empty");
    const r2 = await runReconciliation(
      { ...vacio.repo, finalizeNota: async () => ({ rows: 1 }) } as any,
      { notaId: "n", claimToken: "t", existentes: [], deseados: [] },
    );
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe("deseados_vacios");
    expect(escrituras(vacio.log)).toHaveLength(0);
  });
});

describe("core: persistencia verificable", () => {
  const dos = [titularValido(), titularValido({ nombre: "Luis Soto", cif_dni: "99", evidencia: { cita: "USUFRUCTO", pagina: 2 }, rol_literal: "usufructo vitalicio" })];

  it("éxito: finaliza una sola vez y en último lugar", async () => {
    const f = repoMemoria();
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ titulares: dos }) }, argsNota({}));
    expect(r.ok).toBe(true);
    expect([r.inserted, r.finalized]).toEqual([2, true]);
    expect(escrituras(f.log).map((x) => x.op)).toEqual(["insert", "insert", "finalize"]);
    expect(f.conteo().finalizes).toBe(1);
  });

  it("segundo insert con 0 filas aborta sin finalizar", async () => {
    const f = repoMemoria({ overrides: { insert: (n) => (n === 2 ? { rows: 0 } : { rows: 1 }) } });
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ titulares: dos }) }, argsNota({}));
    expect(r.reason).toBe("titular_insert_fail");
    expect(f.conteo().finalizes).toBe(0);
  });

  it("update con 0 filas aborta sin finalizar", async () => {
    const f = repoMemoria({
      filas: [fila({ id: "r1" })],
      overrides: { update: () => ({ rows: 0 }) },
    });
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ titulares: [titularValido()] }) }, argsNota({}));
    expect(r.reason).toBe("titular_update_fail");
    expect(f.conteo().finalizes).toBe(0);
  });

  it("finalize con 0 filas => claim_lost", async () => {
    const f = repoMemoria({ overrides: { finalize: () => ({ rows: 0 }) } });
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ titulares: [titularValido()] }) }, argsNota({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("claim_lost");
    expect(r.finalized).toBe(false);
  });

  it("fallo de lectura de titulares no escribe nada", async () => {
    const f = repoMemoria({ readError: "boom" });
    const r = await processNotaCore({ repo: f.repo, extract: extractorDe({ titulares: [titularValido()] }) }, argsNota({}));
    expect(r.reason).toBe("titulares_read_fail");
    expect(escrituras(f.log)).toHaveLength(0);
  });

  it("LLM caído => llm_fail sin escrituras", async () => {
    const f = repoMemoria();
    const r = await processNotaCore({ repo: f.repo, extract: async () => ({ data: null, error: "HTTP 429" }) }, argsNota({}));
    expect(r.reason).toBe("llm_fail");
    expect(f.log).toHaveLength(0);
  });

  it("reintento real: la segunda pasada converge sin nuevas escrituras", async () => {
    const store = repoMemoria();
    const deps = { repo: store.repo, extract: extractorDe({ titulares: [titularValido()] }) };
    const r1 = await processNotaCore(deps, argsNota({}));
    expect(r1.inserted).toBe(1);
    store.log.length = 0;
    const r2 = await processNotaCore(deps, argsNota({}));
    expect(r2.ok).toBe(true);
    expect([r2.inserted, r2.updated]).toEqual([0, 0]);
    expect(escrituras(store.log).map((x) => x.op)).toEqual(["finalize"]);
  });
});

// ---------------- matching ----------------

describe("matching", () => {
  it("éxito parcial dispara matching y conserva HTTP 500", () => {
    const resumen = summarizeBatch(2, 1, ["nota-2:llm_fail"]);
    expect(resumen.http).toBe(500);
    const d = decideMatching({ ok: 1, failed: resumen.records_failed });
    expect(d.run).toBe(true);
    expect(d.reason).toBe("parcial_con_exitos");
    expect(decideMatching({ ok: 0, failed: 2 }).run).toBe(false);
  });

  it("fallo del RPC se registra aparte y deja marcador pendiente", async () => {
    const err = await runMatching(async () => ({ data: null, error: { message: "deadlock" } }));
    expect([err.status, err.pending, err.error]).toEqual(["error", true, "deadlock"]);
    const exc = await runMatching(async () => { throw new Error("timeout"); });
    expect([exc.status, exc.pending]).toEqual(["error", true]);
    const ok = await runMatching(async () => ({ data: { matched: 3 } }));
    expect([ok.status, ok.pending, ok.data]).toEqual(["ok", false, { matched: 3 }]);
  });

  it("drenado: sólo intenta si quedó pendiente y no deja el pendiente vivo", async () => {
    expect(decidePendingMatchOnDrain(null).run).toBe(false);
    expect(decidePendingMatchOnDrain({ metadatos: { match_pending: false } }).run).toBe(false);
    const d = decidePendingMatchOnDrain({ metadatos: { match_pending: true } });
    expect(d.run).toBe(true);
    const outcome = await runMatching(async () => ({ data: { matched: 1 } }));
    expect(outcome.pending).toBe(false);
    expect(decidePendingMatchOnDrain({ metadatos: { match_pending: outcome.pending } }).run).toBe(false);
  });
});

// ---------------- match_pending durable ----------------

const HIST = 25;
const logPend = (v: unknown) => ({ metadatos: { match_pending: v } } as any);

/** Simulación del handler real: lee estado durable, corre RPC y decide log/HTTP. */
async function cicloLote(args: {
  rows: any[] | null; readError?: unknown;
  ok: number; total: number; errores?: string[];
  rpc?: () => Promise<{ data?: unknown; error?: any }>;
}) {
  const prev = foldMatchPendingHistory({ rows: args.rows as any, error: args.readError ?? null, limit: HIST });
  const resumen = summarizeBatch(args.total, args.ok, args.errores ?? []);
  const decision = decideMatching({ ok: args.ok, failed: resumen.records_failed });
  const outcome = decision.run && args.rpc ? await runMatching(args.rpc) : null;
  const next = computeNextMatchPending({ previous: prev, ran: decision.run, outcome });
  const http = next.degraded && resumen.http < 400 ? 500 : resumen.http;
  const status = next.degraded && resumen.status === "ok" ? "partial" : resumen.status;
  return { prev, next, http, status, logged: { match_pending: next.pending, state_read_error: next.stateReadError } };
}

async function cicloDrenado(args: { rows: any[] | null; readError?: unknown; rpc: () => Promise<{ data?: unknown; error?: any }> }) {
  const prev = foldMatchPendingHistory({ rows: args.rows as any, error: args.readError ?? null, limit: HIST });
  const decision = decidePendingMatchOnDrainState(prev);
  const outcome = decision.run ? await runMatching(args.rpc) : null;
  const next = computeNextMatchPending({ previous: prev, ran: decision.run, outcome });
  const degradado = next.pending && (outcome?.status === "error" || next.degraded);
  return { decision, next, http: degradado ? 500 : 200, status: degradado ? "partial" : "ok" };
}

describe("match_pending durable", () => {
  it("pliega el historial hasta el último boolean real", () => {
    const s = foldMatchPendingHistory({ rows: [{ metadatos: { otra: 1 } } as any, logPend(true), logPend(false)], limit: HIST });
    expect(s).toEqual({ known: true, pending: true, source: "log" });
    expect(foldMatchPendingHistory({ rows: [], limit: HIST })).toEqual({ known: true, pending: false, source: "sin_historial" });
    expect(foldMatchPendingHistory({ rows: [logPend("true")], limit: HIST }).known).toBe(true);
  });

  it("error de lectura o historial agotado => estado desconocido y conservador", () => {
    const e = foldMatchPendingHistory({ rows: null, error: { message: "boom" }, limit: HIST });
    expect([e.known, e.pending]).toEqual([false, true]);
    expect((e as any).reason).toContain("state_read_error");
    const agotado = foldMatchPendingHistory({ rows: [{ metadatos: {} }, { metadatos: null }], limit: 2 });
    expect([agotado.known, agotado.pending]).toEqual([false, true]);
  });

  it("pending previo true + lote sin éxitos => el log CONSERVA true y drenado reintenta", async () => {
    const c = await cicloLote({ rows: [logPend(true)], ok: 0, total: 3, errores: ["a", "b", "c"] });
    expect(c.next.reason).toBe("conservado");
    expect(c.logged.match_pending).toBe(true);
    expect(c.http).toBe(500);
    const drenado = await cicloDrenado({ rows: [logPend(true)], rpc: async () => ({ data: { matched: 2 } }) });
    expect(drenado.decision.run).toBe(true);
    expect(drenado.next.pending).toBe(false);
    expect(drenado.http).toBe(200);
  });

  it("varios fallos posteriores NO borran el pendiente anterior", async () => {
    const c = await cicloLote({ rows: [logPend(false), logPend(true)], ok: 0, total: 2, errores: ["x"] });
    expect(c.logged.match_pending).toBe(false); // el más reciente manda
    const c2 = await cicloLote({ rows: [logPend(true), logPend(false)], ok: 0, total: 2, errores: ["x"] });
    expect(c2.logged.match_pending).toBe(true);
  });

  it("estado ilegible conserva pendiente y responde partial / no-2xx", async () => {
    const c = await cicloLote({ rows: null, readError: { message: "timeout" }, ok: 0, total: 0 });
    expect(c.next.pending).toBe(true);
    expect(c.next.degraded).toBe(true);
    expect(c.logged.state_read_error).toContain("state_read_error");
    expect([c.http, c.status]).toEqual([500, "partial"]);
  });

  it("drenado: RPC fallido conserva true y devuelve no-2xx; RPC OK limpia", async () => {
    const fail = await cicloDrenado({ rows: [logPend(true)], rpc: async () => ({ error: { message: "deadlock" } }) });
    expect(fail.next.pending).toBe(true);
    expect([fail.http, fail.status]).toEqual([500, "partial"]);
    const ok = await cicloDrenado({ rows: [logPend(true)], rpc: async () => ({ data: { matched: 1 } }) });
    expect(ok.next.pending).toBe(false);
    expect([ok.http, ok.status]).toEqual([200, "ok"]);
    const nada = await cicloDrenado({ rows: [logPend(false)], rpc: async () => ({ data: 1 }) });
    expect(nada.decision.run).toBe(false);
    expect(nada.next.pending).toBe(false);
  });

  it("parcial: una nota OK dispara matching y HTTP 500 por las otras, sin desfinalizar la buena", async () => {
    const store = repoMemoria();
    const buena = await processNotaCore(
      { repo: store.repo, extract: extractorDe({ titulares: [titularValido()] }) },
      argsNota({}),
    );
    expect([buena.ok, buena.finalized]).toEqual([true, true]);
    const c = await cicloLote({
      rows: [logPend(false)], ok: 1, total: 3, errores: ["n2:llm_fail", "n3:llm_fail"],
      rpc: async () => ({ error: { message: "deadlock" } }),
    });
    expect(c.next.reason).toBe("rpc_fail");
    expect(c.logged.match_pending).toBe(true);
    expect([c.http, c.status]).toEqual([500, "partial"]);
    // la nota buena sigue finalizada: el matching fallido no revierte nada
    expect(store.conteo().finalizes).toBe(1);
  });
});
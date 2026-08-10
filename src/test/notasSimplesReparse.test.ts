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
    const plan = buildReconcilePlan([fila({ id: "r1" }), fila({ id: "r2" })], [d]);
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

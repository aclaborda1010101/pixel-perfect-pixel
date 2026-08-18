import { describe, it, expect } from "vitest";
import {
  claveCache,
  costeEstimado,
  evaluarAmbiguedad,
  extraerHallazgos,
  normalizarDocumento,
  normalizarTelefono,
  partirNombre,
  planInvestigacion,
  type SujetoInvestigacion,
} from "../../supabase/functions/_shared/investigacion/plan.ts";

const base: SujetoInvestigacion = {
  ownerId: "o1", buildingId: "b1", nombre: "María López Sanz",
  direccionEdificio: "Calle Pozas 3", ciudad: "Madrid", provincia: "Madrid",
};

describe("plan de investigación T-01", () => {
  it("con documento entra por documento y sigue con la ficha completa", () => {
    const pasos = planInvestigacion({ ...base, documento: "12345678-Z" });
    expect(pasos.map((p) => p.tipo)).toEqual(["dni", "person", "phone_directory", "phone_directory_detalle"]);
    expect(pasos[0].body).toEqual({ dni: "12345678Z" });
  });

  it("sin documento y con dirección usa la búsqueda combinada", () => {
    expect(planInvestigacion(base)[0].tipo).toBe("combined");
  });

  it("sin documento ni dirección usa la búsqueda por nombre", () => {
    expect(planInvestigacion({ ...base, direccionEdificio: null })[0].tipo).toBe("simple");
  });

  it("sin nombre ni documento no hay nada que buscar", () => {
    expect(planInvestigacion({ ...base, nombre: null, direccionEdificio: null })).toEqual([]);
  });

  it("suma el coste en monedas separando lo condicional", () => {
    const c = costeEstimado(planInvestigacion({ ...base, documento: "12345678Z" }));
    expect(c.minimo).toBe(15); // 5 documento + 10 ficha
    expect(c.maximo).toBe(30); // + 5 + 10 directorio telefónico
  });

  it("la clave de caché es estable frente a tildes y formato", () => {
    const a = claveCache("dni", { ...base, documento: "12.345.678-z" });
    const b = claveCache("dni", { ...base, documento: "12345678Z" });
    expect(a).toBe(b);
    expect(claveCache("combined", base)).toBe(
      claveCache("combined", { ...base, nombre: "maria  lopez sanz" }),
    );
  });
});

describe("normalización", () => {
  it("descarta documentos incompletos", () => {
    expect(normalizarDocumento("123")).toBeNull();
    expect(normalizarDocumento("X1234567L")).toBe("X1234567L");
  });
  it("acepta sólo teléfonos españoles plausibles", () => {
    expect(normalizarTelefono("+34 600 11 22 33")).toBe("600112233");
    expect(normalizarTelefono("28001")).toBeNull();
  });
  it("parte nombres compuestos", () => {
    expect(partirNombre("Juan Carlos Pérez Gil")).toEqual({
      first_name: "JUAN CARLOS", last_name: "PEREZ", mother_last_name: "GIL",
    });
  });
});

describe("hallazgos y ambigüedad", () => {
  const respuesta = {
    results: [{
      personId: "P1",
      phones: ["600111222", "no-es-telefono"],
      addresses: [
        { address: "Calle Ejemplo 1", town: "Madrid", postal_code: "28001", current: true },
        { address: "Calle Anterior 9", town: "Madrid", current: false },
      ],
      company: { name: "EJEMPLO SL" },
    }],
  };

  it("extrae teléfonos, domicilios y empresa sin inventar campos", () => {
    const h = extraerHallazgos(respuesta);
    expect(h.telefonos).toEqual(["600111222"]);
    expect(h.domicilios.length).toBe(2);
    expect(h.domicilios[0].actual).toBe(true);
    expect(h.domicilios[1].actual).toBe(false);
    expect(h.empresa).toEqual({ name: "EJEMPLO SL" });
  });

  it("con documento y un candidato no hay ambigüedad", () => {
    const h = extraerHallazgos(respuesta);
    expect(evaluarAmbiguedad(h, { ...base, documento: "12345678Z" }).ambiguo).toBe(false);
  });

  it("homónimos sin documento: propuesta ambigua y no se contacta", () => {
    const h = extraerHallazgos({ results: [{ personId: "P1" }, { personId: "P2" }] });
    const r = evaluarAmbiguedad(h, base);
    expect(r.ambiguo).toBe(true);
    expect(r.motivo).toMatch(/no se contacta/i);
  });
});
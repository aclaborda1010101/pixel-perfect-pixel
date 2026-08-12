import { describe, it, expect } from "vitest";
import { calcularCadencia, agruparLlamadas, permiteTipo } from "@/lib/cadencias";

const AHORA = new Date("2026-08-12T10:00:00Z"); // miércoles
const hace = (d: number) => new Date(AHORA.getTime() - d * 86400000).toISOString();

describe("cadencias de seguimiento por situación", () => {
  it("sin llamadas: primera llamada elegible ya", () => {
    const c = calcularCadencia({ llamadas: [], ahora: AHORA });
    expect(c.situacion).toBe("no_contactado");
    expect(c.elegible).toBe(true);
    expect(permiteTipo(c, "T-02_03")).toBe(true);
    expect(permiteTipo(c, "T-04")).toBe(false);
  });

  it("un intento fallido: reintento a 3 días laborables", () => {
    const c = calcularCadencia({
      llamadas: [{ fecha: hace(1), outcome: "no_contestado", duracion_seg: 5 }],
      ahora: AHORA,
    });
    expect(c.situacion).toBe("no_contactado_reintento");
    expect(c.elegible).toBe(false);
    // martes + 3 laborables = viernes
    expect(c.elegibleDesde.toISOString().slice(0, 10)).toBe("2026-08-14");
  });

  it("tres intentos fallidos: no más llamadas, investigación", () => {
    const c = calcularCadencia({
      llamadas: [hace(9), hace(6), hace(3)].map((fecha) => ({ fecha, outcome: "no_contestado" })),
      ahora: AHORA,
    });
    expect(c.situacion).toBe("no_contactado_agotado");
    expect(c.accion).toBe("investigacion");
    expect(permiteTipo(c, "T-02_03")).toBe(false);
    expect(permiteTipo(c, "T-01")).toBe(true);
  });

  it("frío: no antes de 45 días desde el último contacto", () => {
    const reciente = calcularCadencia({
      llamadas: [{ fecha: hace(20), outcome: "no_interesado", sentiment: "neutro" }],
      ahora: AHORA,
    });
    expect(reciente.situacion).toBe("frio");
    expect(reciente.elegible).toBe(false);
    expect(permiteTipo(reciente, "T-04")).toBe(false);
    expect(permiteTipo(reciente, "T-02_03")).toBe(false);

    const viejo = calcularCadencia({
      llamadas: [{ fecha: hace(50), outcome: "no_interesado" }],
      ahora: AHORA,
    });
    expect(viejo.elegible).toBe(true);
    expect(permiteTipo(viejo, "T-04")).toBe(true);
  });

  it("posible interés: seguimiento a los 14 días", () => {
    const c = calcularCadencia({
      llamadas: [{ fecha: hace(20), outcome: "no_interesado" }],
      estadoEdificio: "posible_interes",
      ahora: AHORA,
    });
    expect(c.situacion).toBe("receptivo");
    expect(c.elegible).toBe(true);
    const nuevo = calcularCadencia({
      llamadas: [{ fecha: hace(5), outcome: "dudoso" }],
      ahora: AHORA,
    });
    expect(nuevo.situacion).toBe("receptivo");
    expect(nuevo.elegible).toBe(false);
  });

  it("interés claro: seguimiento semanal", () => {
    const c = calcularCadencia({ llamadas: [{ fecha: hace(8), outcome: "interesado" }], ahora: AHORA });
    expect(c.situacion).toBe("interes_claro");
    expect(c.dias).toBe(7);
    expect(c.elegible).toBe(true);
  });

  it("sin respuesta tras contacto serio: 30 días", () => {
    const c = calcularCadencia({
      llamadas: [
        { fecha: hace(60), outcome: "no_interesado" },
        { fecha: hace(10), outcome: "no_contestado" },
      ],
      ahora: AHORA,
    });
    expect(c.situacion).toBe("sin_respuesta");
    expect(c.dias).toBe(30);
    expect(c.elegible).toBe(false);
  });

  it("nunca primera llamada a alguien ya contactado", () => {
    for (const outcome of ["interesado", "dudoso", "no_interesado", "otro"]) {
      const c = calcularCadencia({ llamadas: [{ fecha: hace(200), outcome }], ahora: AHORA });
      expect(permiteTipo(c, "T-02_03")).toBe(false);
      expect(c.accion).toBe("seguimiento");
    }
  });

  it("fecha límite = fecha de cadencia + 2 días laborables", () => {
    const c = calcularCadencia({ llamadas: [], ahora: new Date("2026-08-13T10:00:00Z") }); // jueves
    expect(c.fechaLimite.toISOString().slice(0, 10)).toBe("2026-08-17"); // lunes
  });

  it("agrupa llamadas por propietario", () => {
    const m = agruparLlamadas([
      { owner_id: "a", fecha: hace(1) },
      { owner_id: "a", fecha: hace(2) },
      { owner_id: "b", fecha: hace(3) },
      { owner_id: null, fecha: hace(4) },
    ]);
    expect(m.get("a")?.length).toBe(2);
    expect(m.get("b")?.length).toBe(1);
    expect(m.size).toBe(2);
  });
});

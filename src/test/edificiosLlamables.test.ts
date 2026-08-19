import { describe, expect, it } from "vitest";
import {
  tiposPermitidosPorEstado,
  redactarTarjeta,
  AVISO_PORCENTAJES_EN_REVISION,
} from "@/lib/generadorTareas";

describe("puedo llamar ≠ sé el porcentaje exacto", () => {
  it("un edificio 'a revisar' admite tareas de llamada", () => {
    const tipos = tiposPermitidosPorEstado("a_revisar");
    expect(tipos).toContain("T-02_03");
    expect(tipos).toContain("T-04");
  });

  it("'verificado pendiente de emparejar' entra igual", () => {
    expect(tiposPermitidosPorEstado("verificado_pendiente_matching")).toContain("T-02_03");
  });

  it("sin nota o sin propietarios sólo se investiga: nunca se llama", () => {
    for (const estado of ["sin_nota", "sin_propietarios"]) {
      expect(tiposPermitidosPorEstado(estado)).toEqual(["T-01"]);
    }
  });

  it("estados desconocidos no generan nada", () => {
    expect(tiposPermitidosPorEstado(null)).toEqual([]);
  });
});

describe("la tarjeta nunca afirma un porcentaje sin verificar", () => {
  const ctx = { direccion: "Calle del Amparo 92", propietario: "Ana Pérez", telefono: "600111222", participacion: 33.5 };

  it("omite el porcentaje y avisa cuando está en revisión", () => {
    const t = redactarTarjeta("T-02_03", { ...ctx, porcentajesEnRevision: true });
    expect(t.description).not.toContain("33.5");
    expect(t.description).toContain(AVISO_PORCENTAJES_EN_REVISION);
  });

  it("lo mantiene cuando el reparto está confirmado", () => {
    const t = redactarTarjeta("T-02_03", ctx);
    expect(t.description).toContain("33.5%");
    expect(t.description).not.toContain(AVISO_PORCENTAJES_EN_REVISION);
  });
});
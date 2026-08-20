import { describe, it, expect } from "vitest";
import { textoUltimaActualizacion, necesitaAviso, resumenCambios, avisoContactosNoCargados, estadoPorcentajesCoherente } from "@/lib/hubspotSync";

const AHORA = new Date("2026-08-20T12:00:00Z");
const foto = (o: Partial<any> = {}) => ({
  propietarios: 10, telefonos: 4, llamadas: 3, fuente_pct: "nota",
  suma_pct: 72, reparto_completo: false, ...o,
});

describe("fecha de última actualización", () => {
  it("habla en horas cuando es reciente", () => {
    expect(textoUltimaActualizacion("2026-08-20T10:00:00Z", AHORA)).toBe("Datos de HubSpot actualizados hace 2 horas");
  });
  it("usa la fecha cuando hace más de una semana", () => {
    expect(textoUltimaActualizacion("2026-08-13T10:00:00Z", AHORA)).toContain("el 13 de agosto");
  });
  it("dice claramente que nunca se ha traído nada", () => {
    expect(textoUltimaActualizacion(null, AHORA)).toMatch(/Nunca/);
  });
  it("avisa a partir de 24 horas y no antes", () => {
    expect(necesitaAviso("2026-08-20T00:00:00Z", AHORA)).toBe(false);
    expect(necesitaAviso("2026-08-18T00:00:00Z", AHORA)).toBe(true);
    expect(necesitaAviso(null, AHORA)).toBe(true);
  });
});

describe("resumen de lo que ha cambiado", () => {
  it("cuenta propietarios, teléfonos, llamadas y el reparto", () => {
    const t = resumenCambios({
      antes: foto(),
      despues: foto({ propietarios: 13, telefonos: 6, llamadas: 8, suma_pct: 100, reparto_completo: true, fuente_pct: "crm" }),
    });
    expect(t).toContain("han añadido 3 propietarios");
    expect(t).toContain("2 teléfonos nuevos");
    expect(t).toContain("5 llamadas");
    expect(t).toContain("el reparto pasa a estar completo");
    expect(t).toContain("los porcentajes pasan a tomarse de HubSpot");
  });
  it("usa singular cuando toca", () => {
    const t = resumenCambios({ antes: foto(), despues: foto({ propietarios: 11, telefonos: 5, llamadas: 4 }) });
    expect(t).toContain("ha añadido 1 propietario");
    expect(t).toContain("1 teléfono nuevo");
    expect(t).toContain("1 llamada");
  });
  it("dice que todo estaba al día si no cambia nada", () => {
    expect(resumenCambios({ antes: foto(), despues: foto() })).toBe("Todo estaba al día: no había nada nuevo que traer.");
  });
  it("nunca inventa cambios cuando algo baja", () => {
    expect(resumenCambios({ antes: foto(), despues: foto({ propietarios: 8 }) })).toBe("Todo estaba al día: no había nada nuevo que traer.");
  });
});

describe("edificios sin propietarios", () => {
  it("avisa de los contactos de HubSpot que faltan por cargar", () => {
    expect(avisoContactosNoCargados(0, 5)).toBe(
      "En HubSpot hay 5 contactos asociados a este edificio que aún no están cargados aquí. Pulsa Actualizar para traerlos.",
    );
    expect(avisoContactosNoCargados(0, 1)).toContain("1 contacto asociado");
  });
  it("no avisa si ya hay propietarios o si HubSpot no tiene contactos", () => {
    expect(avisoContactosNoCargados(3, 5)).toBeNull();
    expect(avisoContactosNoCargados(0, 0)).toBeNull();
  });
  it("impide marcar como verificado un edificio sin propietarios cargados", () => {
    expect(estadoPorcentajesCoherente("verificado", 0)).toBe("sin_propietarios");
    expect(estadoPorcentajesCoherente("verificado_pendiente_matching", 0)).toBe("sin_propietarios");
    expect(estadoPorcentajesCoherente("verificado", 2)).toBe("verificado");
    expect(estadoPorcentajesCoherente("a_revisar", 0)).toBe("a_revisar");
  });
});

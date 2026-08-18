import { describe, it, expect } from "vitest";
import {
  PLANTILLA_T23_POR_DEFECTO,
  decidirDestino,
  parseGeneratedTaskKey,
  renderPlantilla,
  resolverTextoFinal,
  tieneConsentimiento,
} from "@/lib/whatsappTarjeta";
import { TERMINOS_PROHIBIDOS } from "@/lib/generadorTareas";

describe("plantilla de WhatsApp", () => {
  it("sustituye las tres variables", () => {
    const out = renderPlantilla(PLANTILLA_T23_POR_DEFECTO, {
      nombre: "María", comercial: "Jesús", direccion: "Calle Mayor 12",
    });
    expect(out).toContain("Hola María");
    expect(out).toContain("soy Jesús de Afflux Property");
    expect(out).toContain("Calle Mayor 12");
    expect(out).not.toMatch(/\{(nombre|comercial|direccion)\}/);
  });

  it("cae a la plantilla por defecto si está vacía", () => {
    expect(renderPlantilla("   ", { nombre: "A", comercial: "B", direccion: "C" }))
      .toContain("Afflux Property");
  });

  it("no contiene términos internos prohibidos", () => {
    const texto = renderPlantilla(PLANTILLA_T23_POR_DEFECTO, {
      nombre: "María", comercial: "Jesús", direccion: "Calle Mayor 12",
    }).toLowerCase();
    for (const t of TERMINOS_PROHIBIDOS) expect(texto).not.toContain(t);
  });
});

describe("modo prueba", () => {
  it("con modo prueba y número, envía al número de prueba", () => {
    expect(decidirDestino({ modoPrueba: true, numeroPrueba: "+34 600 111 222", telefonoPropietario: "600999888" }))
      .toEqual({ modo: "prueba", telefono: "34600111222" });
  });
  it("con modo prueba sin número, queda simulado y nunca usa el del propietario", () => {
    const d = decidirDestino({ modoPrueba: true, numeroPrueba: "", telefonoPropietario: "600999888" });
    expect(d.modo).toBe("simulado");
    expect(d.telefono).toBeNull();
  });
  it("sin modo prueba envía al propietario", () => {
    expect(decidirDestino({ modoPrueba: false, telefonoPropietario: "600 999 888" }))
      .toEqual({ modo: "real", telefono: "600999888" });
  });
  it("sin teléfono del propietario y sin modo prueba, no hay envío", () => {
    expect(decidirDestino({ modoPrueba: false, telefonoPropietario: null }).modo).toBe("simulado");
  });
});

describe("consentimiento", () => {
  const owner = "11111111-1111-1111-1111-111111111111";
  it("exige señal afirmativa del propietario correcto", () => {
    expect(tieneConsentimiento([], owner)).toBe(false);
    expect(tieneConsentimiento([{ owner_id: owner, veredicto: "no" }], owner)).toBe(false);
    expect(tieneConsentimiento([{ owner_id: "otro", veredicto: "si" }], owner)).toBe(false);
    expect(tieneConsentimiento([{ owner_id: owner, veredicto: "SÍ" }], owner)).toBe(true);
  });
});

describe("clave de tarea", () => {
  it("extrae el propietario de la clave del generador", () => {
    const k = "v5:gen1:T2_T3:bbb:ooo:20260811T101010";
    expect(parseGeneratedTaskKey(k)).toEqual({ code: "T2_T3", buildingId: "bbb", subjectId: "ooo" });
  });
  it("falla cerrado con claves ajenas", () => {
    expect(parseGeneratedTaskKey("v5:2026-01-01:T-02:xxx")).toBeNull();
    expect(parseGeneratedTaskKey(null)).toBeNull();
  });
});

describe("vista previa y edición a mano", () => {
  const base = renderPlantilla(PLANTILLA_T23_POR_DEFECTO, {
    nombre: "María", comercial: "Jesús", direccion: "Calle Mayor 12",
  });
  it("sin edición se envía el texto de la plantilla", () => {
    expect(resolverTextoFinal(base, undefined)).toEqual({ texto: base, editado: false });
    expect(resolverTextoFinal(base, base)).toEqual({ texto: base, editado: false });
    expect(resolverTextoFinal(base, "   ")).toEqual({ texto: base, editado: false });
  });
  it("un texto distinto se envía tal cual y queda marcado como modificado", () => {
    const out = resolverTextoFinal(base, "  Hola María, te llamo mañana.  ");
    expect(out).toEqual({ texto: "Hola María, te llamo mañana.", editado: true });
  });
  it("los espacios de más no cuentan como edición", () => {
    expect(resolverTextoFinal(base, `  ${base}  `).editado).toBe(false);
  });
});

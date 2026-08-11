import { describe, expect, it } from "vitest";
import {
  hayInterlocutorActivo,
  permiteTareaHaciaPropietario,
  propietariosContactables,
  textoBanderaInterlocutor,
} from "@/lib/interlocutor";
import {
  SITUACIONES_EDIFICIO,
  situacionLabel,
  esPosibleInteres,
} from "@/lib/situacionComercial";
import { contieneTerminoProhibido } from "@/lib/generadorTareas";

describe("situación comercial", () => {
  it("incluye 'Posible interés' entre identificado/contactado y en estudio", () => {
    expect(SITUACIONES_EDIFICIO).toContain("posible_interes");
    expect(SITUACIONES_EDIFICIO.indexOf("posible_interes")).toBeGreaterThan(
      SITUACIONES_EDIFICIO.indexOf("contactado"),
    );
    expect(SITUACIONES_EDIFICIO.indexOf("posible_interes")).toBeLessThan(
      SITUACIONES_EDIFICIO.indexOf("en_estudio"),
    );
    expect(situacionLabel("posible_interes")).toBe("Posible interés");
    expect(esPosibleInteres("posible_interes")).toBe(true);
    expect(esPosibleInteres("contactado")).toBe(false);
  });

  it("las etiquetas están en lenguaje llano", () => {
    for (const s of SITUACIONES_EDIFICIO) {
      expect(contieneTerminoProhibido(situacionLabel(s))).toBeNull();
    }
  });
});

describe("bloqueo por interlocutor activo", () => {
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";

  it("sin interlocutor no bloquea a nadie", () => {
    expect(hayInterlocutorActivo(null)).toBe(false);
    expect(permiteTareaHaciaPropietario(null, B)).toBe(true);
    expect(propietariosContactables(null, [{ owner_id: A }, { owner_id: B }])).toHaveLength(2);
  });

  it("con interlocutor sólo permite tareas hacia él", () => {
    expect(permiteTareaHaciaPropietario(A, A)).toBe(true);
    expect(permiteTareaHaciaPropietario(A, B)).toBe(false);
    expect(permiteTareaHaciaPropietario(A, null)).toBe(false);
    expect(propietariosContactables(A, [{ owner_id: A }, { owner_id: B }])).toEqual([{ owner_id: A }]);
  });

  it("la bandera se lee en lenguaje llano y sin jerga", () => {
    const t = textoBanderaInterlocutor("Ana Pérez");
    expect(t).toBe("Interlocutor activo: Ana Pérez — no contactar a otros propietarios");
    expect(contieneTerminoProhibido(t)).toBeNull();
    expect(textoBanderaInterlocutor(null)).toContain("no contactar a otros propietarios");
  });
});

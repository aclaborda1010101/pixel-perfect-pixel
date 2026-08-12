import { describe, expect, it } from "vitest";
import { parseTarjetaTarea } from "@/lib/tarjetaTarea";
import { resumenConsentimiento } from "@/lib/whatsappTarjeta";

const DESC = [
  "Qué hacer",
  "1. Llama a María López al 600111222.",
  "2. Preséntate y explica el motivo.",
  "",
  "Objetivo",
  "Hablar con el propietario de Calle Segovia 35.",
  "",
  "Al terminar",
  "Registra la llamada con su resultado.",
].join("\n");

describe("parseTarjetaTarea", () => {
  it("separa las tres secciones con sus líneas", () => {
    const r = parseTarjetaTarea(DESC);
    expect(r.secciones.map((s) => s.titulo)).toEqual(["Qué hacer", "Objetivo", "Al terminar"]);
    expect(r.secciones[0].lineas).toHaveLength(2);
    expect(r.secciones[1].lineas[0]).toContain("Calle Segovia 35");
  });

  it("también parsea texto corrido sin saltos de línea", () => {
    const plano = DESC.replace(/\n+/g, " ");
    const r = parseTarjetaTarea(plano);
    expect(r.secciones).toHaveLength(3);
    expect(r.secciones[2].lineas[0]).toContain("Registra la llamada");
  });

  it("devuelve vacío si no hay texto", () => {
    expect(parseTarjetaTarea(null)).toEqual({ intro: [], secciones: [] });
  });
});

describe("resumenConsentimiento", () => {
  it("detecta autorización previa con fecha y origen de llamada", () => {
    const r = resumenConsentimiento(
      [
        { owner_id: "o1", veredicto: "autorizado", fecha_llamada: "2026-07-29T10:00:00Z", hs_call_id: "c1" },
        { owner_id: "o1", veredicto: "autorizado", detectado_at: "2026-08-01T10:00:00Z" },
      ],
      "o1",
    );
    expect(r.autorizado).toBe(true);
    expect(r.fecha).toBe("2026-07-29T10:00:00.000Z");
    expect(r.origen).toBe("llamada");
  });

  it("sin señales afirmativas no autoriza", () => {
    const r = resumenConsentimiento([{ owner_id: "o1", veredicto: "dudoso" }], "o1");
    expect(r).toEqual({ autorizado: false, fecha: null, origen: null });
  });
});

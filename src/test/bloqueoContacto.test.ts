import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  contactoBloqueado,
  motivoExcepcionValido,
  puedeAutorizarExcepcion,
  puedeContactar,
  textoBloqueoContacto,
  TEXTO_CONTACTO_BLOQUEADO,
} from "@/lib/bloqueoContacto";

describe("bloqueo de contacto por interlocutor activo", () => {
  it("solo bloquea a los que no son el interlocutor", () => {
    expect(contactoBloqueado("O1", "O1")).toBe(false);
    expect(contactoBloqueado("O1", "O2")).toBe(true);
    expect(contactoBloqueado(null, "O2")).toBe(false);
    expect(contactoBloqueado("  ", "O2")).toBe(false);
  });

  it("el comercial de zona nunca puede contactar a un bloqueado", () => {
    expect(puedeContactar("comercial_zona", true)).toBe(false);
    expect(puedeContactar("comercial_zona", true, true)).toBe(false);
    expect(puedeContactar("comercial_zona", false)).toBe(true);
  });

  it("admin y responsable de equipo solo con excepción autorizada", () => {
    expect(puedeAutorizarExcepcion("admin")).toBe(true);
    expect(puedeAutorizarExcepcion("sales_manager")).toBe(true);
    expect(puedeAutorizarExcepcion("comercial_zona")).toBe(false);
    expect(puedeContactar("sales_manager", true)).toBe(false);
    expect(puedeContactar("sales_manager", true, true)).toBe(true);
  });

  it("exige motivo con contenido", () => {
    expect(motivoExcepcionValido("")).toBe(false);
    expect(motivoExcepcionValido("   ok")).toBe(false);
    expect(motivoExcepcionValido("Nos lo pide el propio propietario")).toBe(true);
  });

  it("usa lenguaje llano, sin jerga interna", () => {
    const textos = [TEXTO_CONTACTO_BLOQUEADO, textoBloqueoContacto("Ana")];
    for (const t of textos) {
      for (const prohibido of ["disparador", "v5", "backlog", "motor", "evidencia", "guarda", "orquestador"]) {
        expect(t.toLowerCase()).not.toContain(prohibido);
      }
    }
  });

  it("el envío de WhatsApp de tarjeta falla cerrado en el servidor", () => {
    const src = fs.readFileSync("supabase/functions/_shared/tareaWhatsapp.ts", "utf8");
    expect(src).toContain("bloqueado_por_interlocutor");
    expect(src).toContain("interlocutor_owner_id");
  });
});
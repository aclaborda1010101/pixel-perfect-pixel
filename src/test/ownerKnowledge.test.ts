import { describe, expect, it } from "vitest";
import { diagnosticKnowledge, isHubspotYes } from "@/lib/ownerKnowledge";

describe("HubSpot diagnostic knowledge", () => {
  it("recognizes the real WhatsApp values", () => {
    expect(isHubspotYes("Sí")).toBe(true);
    expect(isHubspotYes("No")).toBe(false);
  });

  it("turns CRM diagnostics into known facts with provenance", () => {
    const result = diagnosticKnowledge({
      whatsapp_abierto: "Sí",
      predisposicion_a_vender: "Quiero vender",
      interes_en_reunion: "Sí",
    });
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ clave: "whatsapp_abierto", evidencia: "WhatsApp autorizado", fuente: "hubspot" }),
      expect.objectContaining({ clave: "predisposicion", evidencia: "Quiero vender", fuente: "hubspot" }),
      expect.objectContaining({ clave: "interes_reunion", evidencia: "Sí", fuente: "hubspot" }),
    ]));
  });

  it("does not mark empty properties as known", () => {
    expect(diagnosticKnowledge({ whatsapp_abierto: "", decide_solo: null })).toEqual([]);
  });
});
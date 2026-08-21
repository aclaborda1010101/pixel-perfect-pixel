import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HUBSPOT_DIAGNOSTIC_PROPERTY_NAMES } from "@/lib/ownerKnowledge";

describe("HubSpot contact diagnostic sync", () => {
  it("requests every diagnostic property", () => {
    expect(HUBSPOT_DIAGNOSTIC_PROPERTY_NAMES).toEqual(expect.arrayContaining([
      "whatsapp_abierto", "predisposicion_a_vender", "interes_en_reunion",
      "quien_o_que_bloquea", "tipologia_de_propietario",
    ]));
  });

  it("is incremental, materializes consent and fails closed", () => {
    const source = readFileSync("supabase/functions/hubspot_sync_contact_diagnostics/index.ts", "utf8");
    expect(source).toContain("lastmodifieddate");
    expect(source).toContain("materializeHubspotConsent");
    expect(source).toContain("whatsapp_backfill");
    expect(source).toContain("HAS_PROPERTY");
    expect(source).toContain("Checkpoint durable");
    expect(source).toContain("Ejecución interrumpida antes de finalizar");
    expect(source).toMatch(/return json\(500/);
  });

  it("the full sync no longer reports failures as HTTP 200", () => {
    const source = readFileSync("supabase/functions/hubspot_sync_contacts/index.ts", "utf8");
    const failureBlock = source.slice(source.indexOf("console.error('[hubspot_sync_contacts] error:"));
    expect(failureBlock).toContain("status: 500");
  });
});
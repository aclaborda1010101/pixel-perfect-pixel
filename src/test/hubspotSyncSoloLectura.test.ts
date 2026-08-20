import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/_shared/hubspotBuildingSync.ts", "utf8");

describe("la sincronización por edificio no escribe en HubSpot", () => {
  const endpoints = Array.from(src.matchAll(/hubspotFetch\(\s*'([^']+)'/g)).map((m) => m[1]);

  it("usa endpoints y todos son de lectura por lotes", () => {
    expect(endpoints.length).toBeGreaterThan(0);
    for (const e of endpoints) expect(e).toMatch(/batch\/read/);
  });

  it("no encola escrituras ni llama a endpoints de creación o borrado", () => {
    expect(src).not.toMatch(/hubspot_write_queue/);
    expect(src).not.toMatch(/batch\/(create|update|archive)/);
    expect(src).not.toMatch(/method:\s*'(PATCH|PUT|DELETE)'/);
  });
});

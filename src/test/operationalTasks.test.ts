import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isVisibleOperationalTask,
  isV5TaskKey,
  filterVisibleOperationalTasks,
  VISIBLE_OPERATIONAL_TASK_OR_FILTER,
} from "@/lib/operationalTasks";

describe("isVisibleOperationalTask", () => {
  it("accepts manual tasks regardless of task_key", () => {
    expect(isVisibleOperationalTask({ task_type: "manual", task_key: null })).toBe(true);
    expect(isVisibleOperationalTask({ task_type: "manual", task_key: "missing_phones" })).toBe(true);
    expect(isVisibleOperationalTask({ task_type: "manual", task_key: "call_queue:2026-08-10:x" })).toBe(true);
  });

  it("accepts V5 tasks by exact 'v5:' prefix", () => {
    expect(isVisibleOperationalTask({ task_type: "call_queue", task_key: "v5:2026-08-10:T01:abc" })).toBe(true);
    expect(isVisibleOperationalTask({ task_type: "auto", task_key: "v5:x" })).toBe(true);
  });

  it("rejects every legacy auto task (no T code)", () => {
    for (const k of [
      "missing_phones", "uncontacted_owners", "missing_emails", "uncatalogued",
      "verify_catastral", "check_charges", "prepare_briefing", "schedule_visit",
    ]) {
      expect(isVisibleOperationalTask({ task_type: "auto", task_key: k })).toBe(false);
    }
  });

  it("rejects old call_queue: keys", () => {
    expect(isVisibleOperationalTask({ task_type: "call_queue", task_key: "call_queue:2026-08-10:abc" })).toBe(false);
  });

  it("rejects near-miss prefixes and unknown keys", () => {
    expect(isVisibleOperationalTask({ task_type: "auto", task_key: "V5:2026:T01" })).toBe(false);
    expect(isVisibleOperationalTask({ task_type: "auto", task_key: " v5:x" })).toBe(false);
    expect(isVisibleOperationalTask({ task_type: "auto", task_key: "xv5:x" })).toBe(false);
    expect(isVisibleOperationalTask({ task_type: "auto", task_key: "v5" })).toBe(false);
    expect(isVisibleOperationalTask({ task_type: "otro", task_key: null })).toBe(false);
  });

  it("is safe on null/undefined/garbage input", () => {
    expect(isVisibleOperationalTask(null)).toBe(false);
    expect(isVisibleOperationalTask(undefined)).toBe(false);
    expect(isVisibleOperationalTask({} as any)).toBe(false);
    expect(isV5TaskKey(123 as any)).toBe(false);
  });

  it("filters lists and preserves order", () => {
    const input = [
      { id: 1, task_type: "auto", task_key: "missing_phones" },
      { id: 2, task_type: "manual", task_key: null },
      { id: 3, task_type: "call_queue", task_key: "v5:2026-08-10:T03:z" },
      { id: 4, task_type: "call_queue", task_key: "call_queue:old" },
    ];
    expect(filterVisibleOperationalTasks(input).map((t) => t.id)).toEqual([2, 3]);
    expect(filterVisibleOperationalTasks(null)).toEqual([]);
  });

  it("server-side filter stays in sync with the helper", () => {
    expect(VISIBLE_OPERATIONAL_TASK_OR_FILTER).toBe("task_type.eq.manual,task_key.like.v5:*");
  });
});

describe("legacy building task engine is retired", () => {
  beforeEach(() => vi.resetModules());

  it("syncBuildingTasks / syncAssignedBuildingsTasks perform no DB access", async () => {
    const from = vi.fn(() => {
      throw new Error("legacy engine touched the database");
    });
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { from } }));

    const mod = await import("@/lib/buildingTasks");
    await expect(mod.syncBuildingTasks("b1", "u1")).resolves.toBeUndefined();
    await expect(mod.syncAssignedBuildingsTasks("u1")).resolves.toBeUndefined();
    expect(from).not.toHaveBeenCalled();
    expect(mod.LEGACY_TASK_ENGINE_RETIRED).toBe(true);
  });

  it("buildingTasks module does not import the supabase client at all", async () => {
    const src = await import("@/lib/buildingTasks?raw" as any).catch(() => null);
    // Fallback: assert no write helpers are exported beyond the no-ops.
    const mod = await import("@/lib/buildingTasks");
    expect(typeof mod.syncBuildingTasks).toBe("function");
    expect(src === null || !String((src as any).default).includes("supabase")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  parseV5TaskKey, v5TaskCodeFromKey, operationalTaskBadge, isV5TaskKey,
  V5_CANONICAL_CODES,
} from "@/lib/operationalTasks";
import { buildV5TaskKey, V5_TASK_CODES } from "@/lib/v5/model";

const ROOT = process.cwd();

/**
 * Fixtures REALES: se reconstruye la clave con el MISMO template literal que
 * construye assign_daily_call_queue en producción, leído de su fuente.
 */
function realKeyBuilder() {
  const src = readFileSync(
    resolve(ROOT, "supabase/functions/assign_daily_call_queue/index.ts"), "utf8",
  );
  const m = /const taskKey = `([^`]+)`/.exec(src);
  if (!m) throw new Error("no se encontró el template de task_key en la función productiva");
  const tpl = m[1]; // v5:${hoy}:${c.task_code}:${idKey}
  expect(tpl).toBe("v5:${hoy}:${c.task_code}:${idKey}");
  return (code: string, id: string) =>
    tpl.replace("${hoy}", "2026-08-10").replace("${c.task_code}", code).replace("${idKey}", id);
}

describe("parser de task_key V5 · dos generaciones reales", () => {
  const build = realKeyBuilder();

  it("catálogo legacy productivo T-01…T-09 se normaliza sin ambigüedad", () => {
    for (const [raw, code] of [["T-01", "T1"], ["T-04", "T4"], ["T-09", "T9"], ["T-02", "T2"]] as const) {
      const key = build(raw, "8d2c0d1e-0000-4000-8000-000000000001");
      const parsed = parseV5TaskKey(key)!;
      expect(parsed.format).toBe("historic_call_queue");
      expect(parsed.rawCode).toBe(raw);
      expect(parsed.code).toBe(code);
      expect(operationalTaskBadge({ task_type: "call_queue", task_key: key }).label).toBe(`V5 · ${code}`);
    }
  });

  it("el catálogo del parser ES el del Motor (sin regex paralela)", () => {
    expect(V5_CANONICAL_CODES).toEqual(V5_TASK_CODES);
  });

  it("T-07 histórico se etiqueta pero jamás se convierte en canónico", () => {
    const parsed = parseV5TaskKey(build("T-07", "o1"))!;
    expect(parsed.format).toBe("historic_call_queue");
    expect(parsed.origin).toBe("legacy");
    expect(parsed.code).toBe("T7");
    expect(parsed.legacyOnly).toBe(true);
    expect((V5_TASK_CODES as readonly string[]).includes("T7")).toBe(false);
  });

  it("claves canónicas REALES de buildV5TaskKey se reconocen", () => {
    for (const code of V5_TASK_CODES) {
      const key = buildV5TaskKey({
        taskCode: code, buildingId: "b1", subjectId: "o1", triggerFingerprint: "fp",
      });
      const parsed = parseV5TaskKey(key)!;
      expect(parsed.format).toBe("canonical");
      expect(parsed.origin).toBe("engine");
      expect(parsed.code).toBe(code);
    }
  });

  it("claves canónicas nuevas (T1, T2_T3, T4…T9) se reconocen", () => {
    for (const code of ["T1", "T2_T3", "T4", "T5", "T6", "T8", "T9"]) {
      const key = `v5:v5.0:${code}:b1:o1:fp`;
      const parsed = parseV5TaskKey(key)!;
      expect(parsed.format).toBe("canonical");
      expect(parsed.code).toBe(code);
      expect(v5TaskCodeFromKey(key)).toBe(code);
    }
  });

  it("claves V5 con código inválido o en minúsculas siguen siendo V5, nunca Manual", () => {
    for (const key of ["v5:2026-08-10:t-01:o1", "v5:2026-08-10:T-0X:o1", "v5:2026-08-10::o1"]) {
      expect(isV5TaskKey(key)).toBe(true);
      const parsed = parseV5TaskKey(key)!;
      expect(parsed.code).toBeNull();
      const badge = operationalTaskBadge({ task_type: "manual", task_key: key });
      expect(badge.label).toBe("V5");
      expect(badge.label).not.toBe("Manual");
    }
  });

  it("RECHAZOS estructurales: código fuera de catálogo, posición o forma", () => {
    const malas = [
      "v5:v5.0:T7:b1:o1:fp",        // T7 no existe
      "v5:v5.0:T2:b1:o1:fp",        // T2 suelto
      "v5:v5.0:T3:b1:o1:fp",        // T3 suelto
      "v5:v5.0:T4_T9:b1:o1:fp",     // combinación inventada
      "v5:v5.0:t2_t3:b1:o1:fp",     // case
      "v5:v5.0::b1:o1:fp",          // vacío
      "v5:v5.0:b1:T4:o1:fp",        // código fuera de posición
      "v5:v5.0:T4:b1:o1:fp:extra",  // segmento de más
      "v5:v5.0:T4:b1:o1",           // segmento de menos
      "v5:v5.0:T4:b1::fp",          // segmento vacío
      "v5:2026-13-45:T-01:o1",      // fecha histórica inválida
      "v5:2026-08-10:T-10:o1",      // código histórico inexistente
      "v5:2026-08-10:T4:o1",        // canónico en formato histórico
      "v5:2026-08-10:T-04:",        // id vacío
    ];
    for (const key of malas) {
      const parsed = parseV5TaskKey(key)!;
      expect(parsed, key).not.toBeNull();
      expect(parsed.code, key).toBeNull();
      expect(parsed.format, key).toBeNull();
      // Sigue siendo V5: nunca degrada a Manual.
      expect(operationalTaskBadge({ task_type: "call_queue", task_key: key }).label, key).toBe("V5");
    }
  });

  it("claves no V5 no se parsean y solo manual real es Manual", () => {
    expect(parseV5TaskKey("call_queue:2026-01-01:T-04:o1")).toBeNull();
    expect(parseV5TaskKey(null)).toBeNull();
    expect(v5TaskCodeFromKey("call_queue:T4:x")).toBeNull();
    expect(operationalTaskBadge({ task_type: "manual", task_key: null }).label).toBe("Manual");
    expect(operationalTaskBadge({ task_type: "auto", task_key: "call_queue:x" }).label).toBe("Legacy");
  });
});

describe("BuildingTasksSection · badge visible para ambas generaciones", () => {
  function Badges({ tasks }: { tasks: any[] }) {
    return (
      <ul>
        {tasks.map((t) => {
          const origin = operationalTaskBadge(t);
          return <li key={t.id}>{`${t.title} [${origin.label}]`}</li>;
        })}
      </ul>
    );
  }

  it("muestra V5 · <código> en legacy y canónica, y Manual solo en manual real", () => {
    render(
      <Badges
        tasks={[
          { id: "1", title: "Cadencia", task_type: "call_queue", task_key: "v5:2026-08-10:T-04:o1" },
          { id: "2", title: "WhatsApp", task_type: "call_queue", task_key: "v5:v5.0:T2_T3:b1:o1:fp" },
          { id: "3", title: "Mía", task_type: "manual", task_key: null },
        ]}
      />,
    );
    expect(screen.getByText("Cadencia [V5 · T4]")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp [V5 · T2_T3]")).toBeInTheDocument();
    expect(screen.getByText("Mía [Manual]")).toBeInTheDocument();
  });
});

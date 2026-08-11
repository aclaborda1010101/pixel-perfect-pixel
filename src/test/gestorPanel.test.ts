import { describe, it, expect } from "vitest";
import { agruparPorComercial, soloReales, conRetraso, totales } from "@/lib/gestorPanel";

const base = {
  id: "1", user_id: "u1", full_name: "Jesús", task_type: "T-01", title: null,
  status: "pending", building_id: "b1", direccion: "Calle A 1",
  started_at: null, created_at: "2026-08-01T00:00:00Z", due_date: null,
};

describe("panel del gestor comercial", () => {
  it("excluye las tareas de demostración", () => {
    const rows = [base, { ...base, id: "2", task_type: "simulation_v5" }];
    expect(soloReales(rows).map((r) => r.id)).toEqual(["1"]);
  });

  it("marca retraso solo con fecha límite pasada", () => {
    const ahora = new Date("2026-08-10T00:00:00Z");
    expect(conRetraso({ ...base, due_date: "2026-08-01T00:00:00Z" }, ahora)).toBe(true);
    expect(conRetraso({ ...base, due_date: "2026-08-20T00:00:00Z" }, ahora)).toBe(false);
    expect(conRetraso(base, ahora)).toBe(false);
  });

  it("agrupa por comercial y totaliza", () => {
    const ahora = new Date("2026-08-10T00:00:00Z");
    const data = {
      from: "", to: "", generated_at: "",
      activas: [
        { ...base, due_date: "2026-08-01T00:00:00Z" },
        { ...base, id: "3", user_id: "u2", full_name: "David" },
        { ...base, id: "4", task_type: "simulation_v5" },
      ],
      realizadas: [{ ...base, id: "5", status: "completed", completed_at: "2026-08-09T00:00:00Z" }],
    };
    const g = agruparPorComercial(data, ahora);
    expect(g.map((x) => x.nombre)).toEqual(["David", "Jesús"]);
    expect(totales(g)).toEqual({ activas: 2, retrasadas: 1, realizadas: 1 });
  });
});

import { describe, it, expect } from "vitest";
import {
  estaRetrasada,
  esHoraLaborable,
  HORARIO_POR_DEFECTO,
  minutosLaborablesEntre,
  normalizarHorario,
} from "@/lib/horarioLaboral";
import { agruparPorSemana, etiquetaSemana, inicioSemana } from "@/lib/gestorPanel";

// Viernes 7 de agosto de 2026 a las 17:00 (hora local).
const viernes17 = new Date(2026, 7, 7, 17, 0, 0);

describe("horario laboral", () => {
  it("por defecto trabaja de lunes a viernes", () => {
    expect(esHoraLaborable(new Date(2026, 7, 7, 10, 0))).toBe(true);
    expect(esHoraLaborable(new Date(2026, 7, 8, 10, 0))).toBe(false); // sábado
    expect(esHoraLaborable(new Date(2026, 7, 7, 20, 0))).toBe(false); // por la noche
  });

  it("el fin de semana no suma retraso", () => {
    const sabado = new Date(2026, 7, 8, 12, 0);
    const domingo = new Date(2026, 7, 9, 20, 0);
    const lunes9 = new Date(2026, 7, 10, 9, 0);
    // Solo cuenta lo que quedaba del viernes (17:00-18:00): el fin de semana no añade nada.
    expect(minutosLaborablesEntre(viernes17, sabado)).toBe(60);
    expect(minutosLaborablesEntre(viernes17, domingo)).toBe(60);
    expect(minutosLaborablesEntre(viernes17, lunes9)).toBe(60);
  });

  it("una tarea que vence al cierre del viernes no se retrasa el fin de semana", () => {
    const viernes18 = new Date(2026, 7, 7, 18, 0);
    expect(estaRetrasada(viernes18, new Date(2026, 7, 8, 12, 0))).toBe(false);
    expect(estaRetrasada(viernes18, new Date(2026, 7, 9, 20, 0))).toBe(false);
    expect(estaRetrasada(viernes18, new Date(2026, 7, 10, 9, 1))).toBe(true);
  });

  it("sin fecha límite nunca hay retraso", () => {
    expect(estaRetrasada(null, new Date())).toBe(false);
  });

  it("recupera un horario válido de cualquier valor guardado", () => {
    expect(normalizarHorario(null)).toEqual(HORARIO_POR_DEFECTO);
    const h = normalizarHorario([
      { activo: true, inicio: "08:00", fin: "15:00" },
      ...HORARIO_POR_DEFECTO.slice(1),
    ]);
    expect(h[0]).toEqual({ activo: true, inicio: "08:00", fin: "15:00" });
    expect(h).toHaveLength(7);
  });
});

describe("histórico por semanas", () => {
  it("la semana empieza en lunes", () => {
    expect(inicioSemana(new Date(2026, 7, 9, 23, 0)).getDay()).toBe(1);
    expect(etiquetaSemana(inicioSemana(viernes17), viernes17)).toBe("Esta semana");
  });

  it("agrupa las realizadas por semana, de la más reciente a la más antigua", () => {
    const base = {
      id: "1", user_id: "u1", full_name: "Jesús", task_type: "T-01", title: null,
      status: "completed", building_id: "b1", direccion: "Calle A 1",
      started_at: null, created_at: null, due_date: null,
    };
    const g = agruparPorSemana(
      [
        { ...base, completed_at: new Date(2026, 7, 6, 10).toISOString() },
        { ...base, id: "2", completed_at: new Date(2026, 6, 29, 10).toISOString() },
        { ...base, id: "3", task_type: "simulation_v5", completed_at: new Date(2026, 7, 6, 10).toISOString() },
      ],
      viernes17,
    );
    expect(g).toHaveLength(2);
    expect(g[0].etiqueta).toBe("Esta semana");
    expect(g[0].tareas.map((t) => t.id)).toEqual(["1"]);
    expect(g[1].etiqueta).toBe("Semana pasada");
  });
});

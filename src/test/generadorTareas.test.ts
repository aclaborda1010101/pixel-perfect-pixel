import { describe, expect, it } from "vitest";
import {
  TIPOS,
  MIX_POR_DEFECTO,
  TERMINOS_PROHIBIDOS,
  contieneTerminoProhibido,
  elegirTipo,
  proximaFechaLimite,
  redactarTarjeta,
  taskKeyFor,
  type Tipo,
} from "@/lib/generadorTareas";
import { isVisibleOperationalTask, operationalTaskBadge } from "@/lib/operationalTasks";

const ctx = {
  direccion: "Calle Mayor 1",
  ciudad: "Madrid",
  propietario: "Ana Pérez",
  telefono: "600111222",
  participacion: 33.5,
};

describe("tarjeta de la tarea", () => {
  it("tiene las tres secciones obligatorias en orden", () => {
    for (const tipo of TIPOS) {
      const t = redactarTarjeta(tipo, ctx);
      const iQue = t.description.indexOf("Qué hacer");
      const iObj = t.description.indexOf("Objetivo");
      const iFin = t.description.indexOf("Al terminar");
      expect(iQue).toBe(0);
      expect(iObj).toBeGreaterThan(iQue);
      expect(iFin).toBeGreaterThan(iObj);
      expect(t.objetivo.length).toBeGreaterThan(0);
      expect(t.pasos_registro.length).toBeGreaterThan(0);
    }
  });

  it("no usa ningún término prohibido en title ni description", () => {
    for (const tipo of TIPOS) {
      for (const sinDatos of [true, false]) {
        const t = redactarTarjeta(tipo, sinDatos ? { direccion: "Calle Sol 3" } : ctx);
        expect(contieneTerminoProhibido(t.title)).toBeNull();
        expect(contieneTerminoProhibido(t.description)).toBeNull();
        expect(contieneTerminoProhibido(t.objetivo)).toBeNull();
        expect(contieneTerminoProhibido(t.pasos_registro)).toBeNull();
      }
    }
    expect(contieneTerminoProhibido("Esto menciona el MOTOR")).toBe("motor");
    expect(TERMINOS_PROHIBIDOS.length).toBe(7);
  });

  it("incluye nombre y teléfono del propietario cuando existen", () => {
    const t = redactarTarjeta("T-02_03", ctx);
    expect(t.title).toBe("Primera llamada — Calle Mayor 1");
    expect(t.description).toContain("Ana Pérez");
    expect(t.description).toContain("600111222");
    expect(t.description.toLowerCase()).toContain("registra la llamada");
  });

  it("titula el seguimiento con el propietario", () => {
    expect(redactarTarjeta("T-04", ctx).title).toBe("Seguimiento — Ana Pérez");
    expect(redactarTarjeta("T-01", ctx).title).toBe("Investigación — Calle Mayor 1");
  });
});

describe("mezcla de trabajo", () => {
  it("sin histórico elige el tipo con mayor peso disponible", () => {
    expect(elegirTipo({ mix: MIX_POR_DEFECTO, historico: [], disponibles: TIPOS })).toBe("T-02_03");
  });

  it("compensa el déficit según el histórico", () => {
    const historico = Array<string>(10).fill("T-02_03");
    // Con el reparto por defecto (Equilibrado 20/40/40) el mayor déficit es el seguimiento.
    expect(elegirTipo({ mix: MIX_POR_DEFECTO, historico, disponibles: TIPOS })).toBe("T-04");
  });

  it("solo elige entre tipos con candidato real", () => {
    const disponibles: Tipo[] = ["T-05", "T-08"];
    expect(disponibles).toContain(elegirTipo({ mix: MIX_POR_DEFECTO, historico: [], disponibles }));
  });
});

describe("planificación y clave", () => {
  it("la fecha límite salta el fin de semana", () => {
    // viernes 2026-08-14 -> martes 2026-08-18
    const d = proximaFechaLimite(new Date("2026-08-14T10:00:00Z"));
    expect(d.toISOString().slice(0, 10)).toBe("2026-08-18");
    const l = proximaFechaLimite(new Date("2026-08-10T10:00:00Z"));
    expect(l.toISOString().slice(0, 10)).toBe("2026-08-12");
  });

  it("genera tareas visibles en la pantalla del comercial", () => {
    const key = taskKeyFor("T-02_03", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", new Date("2026-08-11T09:00:00Z"));
    const task = { task_type: "T-02_03", task_key: key };
    expect(isVisibleOperationalTask(task)).toBe(true);
    expect(operationalTaskBadge(task).label).toBe("V5 · T2_T3");
  });
});

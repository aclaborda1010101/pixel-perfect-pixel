import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  actividadReal,
  AVISO_IMPORTES,
  AVISO_MAQUETA,
  COMERCIALES_EJEMPLO,
  COMPENSACION,
  INDICADORES,
  puntuar,
  puntuarTodos,
  REGLAS_JUEGO_LIMPIO,
  sumaPesos,
  textoMetrica,
} from "@/lib/productividad";
import { decideAccess } from "@/lib/access";
import type { PanelData } from "@/lib/gestorPanel";

describe("indicadores del documento del cliente", () => {
  it("son exactamente seis y suman 100", () => {
    expect(INDICADORES).toHaveLength(6);
    expect(sumaPesos()).toBe(100);
  });

  it("respeta nombres y pesos acordados", () => {
    expect(INDICADORES.map((i) => [i.numero, i.peso])).toEqual([
      [1, 15],
      [2, 25],
      [3, 15],
      [4, 15],
      [5, 15],
      [6, 15],
    ]);
    expect(INDICADORES[1].nombre).toBe("Cuadro de rentas y vencimiento de contratos");
    expect(INDICADORES[5].nombre).toBe("Reunión cualificada con especialista");
  });
});

describe("puntuación de ejemplo", () => {
  it("pondera por peso y nunca pasa de 100", () => {
    const perfecto = puntuar({
      nombre: "X",
      logros: Object.fromEntries(INDICADORES.map((i) => [i.id, 100])),
    });
    expect(perfecto.total).toBe(100);
    const cero = puntuar({ nombre: "Y", logros: {} });
    expect(cero.total).toBe(0);
  });

  it("compara a los dos comerciales de ejemplo", () => {
    const ps = puntuarTodos();
    expect(ps.map((p) => p.nombre)).toEqual(["Jesús", "David"]);
    expect(ps[0].total).toBeGreaterThan(ps[1].total);
    expect(ps[0].lineas).toHaveLength(6);
  });

  it("los ejemplos no se guardan: son constantes en memoria", () => {
    const src = readFileSync("src/lib/productividad.ts", "utf8");
    expect(COMERCIALES_EJEMPLO).toHaveLength(2);
    expect(src).not.toMatch(/supabase|\.from\(|insert|upsert/i);
  });
});

describe("actividad real", () => {
  const hoy = new Date("2026-08-18T12:00:00Z");
  const data: PanelData = {
    from: "",
    to: "",
    generated_at: "",
    comerciales: [{ user_id: "u1", full_name: "Jesús" }],
    activas: [],
    realizadas: [
      {
        id: "t1",
        user_id: "u1",
        full_name: "Jesús",
        task_type: "T-01",
        title: null,
        status: "completed",
        building_id: null,
        direccion: null,
        started_at: null,
        due_date: null,
        completed_at: "2026-08-18T09:00:00Z",
      },
      {
        id: "t2",
        user_id: "u1",
        full_name: "Jesús",
        task_type: "T-01",
        title: null,
        status: "completed",
        building_id: null,
        direccion: null,
        started_at: null,
        due_date: null,
        completed_at: "2026-08-04T09:00:00Z",
      },
    ],
  };

  it("cuenta tareas verdaderas por hoy/semana/mes", () => {
    const [a] = actividadReal(data, { u1: 3 }, hoy);
    expect(a.hoy.valor).toBe(1);
    expect(a.semana.valor).toBe(1);
    expect(a.mes.valor).toBe(2);
    expect(a.retrasadas.valor).toBe(3);
  });

  it("sin llamadas ni WhatsApp atribuidos muestra guion, no un cero", () => {
    const [a] = actividadReal(data, {}, hoy);
    expect(a.llamadas.disponible).toBe(false);
    expect(textoMetrica(a.llamadas)).toBe("—");
    expect(textoMetrica(a.whatsapps)).toBe("—");
  });

  it("usa el dato verdadero cuando existe", () => {
    const [a] = actividadReal(data, {}, hoy, { u1: { llamadas: 12, whatsapps: 0 } });
    expect(textoMetrica(a.llamadas)).toBe("12");
    expect(a.whatsapps.disponible).toBe(true);
  });
});

describe("acabado de la maqueta", () => {
  const ui = readFileSync("src/components/gestor/ProductividadTab.tsx", "utf8");

  it("el aviso de vista de diseño es permanente y literal", () => {
    expect(AVISO_MAQUETA).toContain("Vista de diseño");
    expect(ui).toContain("AVISO_MAQUETA");
    expect(ui).not.toContain("{mostrarAviso &&");
  });

  it("incluye compensación con su aviso literal y las tres reglas", () => {
    expect(AVISO_IMPORTES).toBe(
      "Importes orientativos, pendientes de definir por la dirección de Afflux",
    );
    expect(COMPENSACION).toHaveLength(4);
    expect(REGLAS_JUEGO_LIMPIO).toHaveLength(3);
  });

  it("no escribe nada: sin inserciones ni HubSpot", () => {
    expect(ui).not.toMatch(/\.from\(|\.insert\(|\.upsert\(|hubspot_/i);
    expect(ui).toContain("ni se envía a HubSpot");
    expect(ui).toContain("get_sales_manager_panel");
  });
});

describe("acceso a la pestaña", () => {
  it("un comercial no entra en el panel del responsable", () => {
    expect(decideAccess({ role: "comercial_zona", pathname: "/gestor-comerciales" })).toEqual({
      type: "redirect",
      to: "/",
    });
  });

  it("responsable y dirección sí entran", () => {
    for (const role of ["sales_manager", "admin"] as const) {
      expect(decideAccess({ role, pathname: "/gestor-comerciales" })).toEqual({ type: "allow" });
    }
  });
});

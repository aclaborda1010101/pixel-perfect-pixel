import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const situacion = readFileSync("src/components/buildings/SituacionEdificioCard.tsx", "utf8");
const interlocutor = readFileSync("src/components/buildings/InterlocutorCard.tsx", "utf8");

describe("controles de decisión · solo dirección y responsable de equipo", () => {
  it("la tarjeta de situación comercial exige rol de decisión para editar", () => {
    expect(situacion).toMatch(/role === "admin" \|\| role === "sales_manager"/);
    // en modo solo lectura no hay desplegable ni botón
    const soloLectura = situacion.split("if (!puedeEditar)")[1].split("return (")[1].split("}")[0];
    expect(soloLectura).not.toContain("<Select");
    expect(soloLectura).not.toContain("<Button");
  });

  it("la tarjeta de interlocutor exige rol de decisión y ya no depende de la asignación", () => {
    expect(interlocutor).toMatch(/puedeGestionar = role === "admin" \|\| role === "sales_manager"/);
    expect(interlocutor).not.toContain("building_assignments");
    const soloLectura = interlocutor.split("if (!puedeGestionar)")[1].split("return (")[1].split("</Card>")[0];
    expect(soloLectura).not.toContain("<Select");
    expect(soloLectura).not.toContain("<Button");
    expect(soloLectura).not.toContain("<Input");
  });
});

describe("refuerzo en el servidor", () => {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");

  it("existe un guardián que rechaza el cambio de situación hecho por un comercial de zona", () => {
    expect(sql).toContain("guard_building_estado_change");
    expect(sql).toMatch(/trg_guard_building_estado_change/);
    expect(sql).toMatch(/'comercial_zona'::app_role/);
  });

  it("marcar interlocutor queda limitado a dirección y responsables de equipo", () => {
    const fn = sql.split("CREATE OR REPLACE FUNCTION public.can_manage_building_interlocutor").pop() ?? "";
    const cuerpo = fn.split("$fn$")[1] ?? "";
    expect(cuerpo).toContain("'admin'::app_role");
    expect(cuerpo).toContain("'sales_manager'::app_role");
    expect(cuerpo).not.toContain("building_assignments");
  });
});

export type TitularCapa = {
  building_id: string;
  nota_id: string;
  fecha_emision_nota: string | null;
  titular_id: string;
  nombre_extraido: string | null;
  cif_dni: string | null;
  porcentaje: number | null;
  rol: string | null;
  es_sociedad: boolean | null;
  tiene_contacto_crm: boolean | null;
};

export type Capa = {
  rol: string;
  label: string;
  titulares: TitularCapa[];
  suma: number | null;
  completa: boolean;
};

export const ROL_LABEL: Record<string, string> = {
  pleno: "Pleno dominio",
  pleno_dominio: "Pleno dominio",
  ganancial: "Ganancial",
  usufructo: "Usufructo",
  nuda_propiedad: "Nuda propiedad",
  otro: "Otro",
};

const ORDEN = ["pleno_dominio", "pleno", "ganancial", "nuda_propiedad", "usufructo", "otro"];

export function rolLabel(rol: string | null) {
  if (!rol) return "Sin capa declarada";
  return ROL_LABEL[rol] ?? rol.replace(/_/g, " ");
}

/**
 * Agrupa titulares por CAPA de derecho. Nunca se suman porcentajes de capas
 * distintas: cada capa (pleno dominio, usufructo, nuda propiedad…) debe sumar
 * ~100 % por sí misma.
 */
export function agruparPorCapa(rows: TitularCapa[]): Capa[] {
  const map = new Map<string, TitularCapa[]>();
  for (const r of rows) {
    const rol = r.rol || "otro";
    const arr = map.get(rol) ?? [];
    arr.push(r);
    map.set(rol, arr);
  }
  const capas: Capa[] = Array.from(map.entries()).map(([rol, titulares]) => {
    const conPct = titulares.filter((t) => t.porcentaje != null && Number.isFinite(Number(t.porcentaje)));
    const suma = conPct.length ? conPct.reduce((s, t) => s + Number(t.porcentaje), 0) : null;
    return {
      rol,
      label: rolLabel(rol),
      titulares,
      suma,
      completa: suma != null && suma >= 99 && suma <= 101,
    };
  });
  capas.sort((a, b) => {
    const ia = ORDEN.indexOf(a.rol);
    const ib = ORDEN.indexOf(b.rol);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return capas;
}

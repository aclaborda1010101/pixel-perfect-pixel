/**
 * Influenciadores vinculados a PERSONA, no a edificio.
 *
 * Un influenciador (la hija de Manolo, su abogado, su hermana) influye sobre un
 * propietario concreto. Al preparar la llamada de Manolo hay que verlo; al
 * llamar a cualquier otro copropietario esa información sobra y despista.
 *
 * La relación vive en `owner_relations`: owner_a_id = el propietario,
 * owner_b_id = quien influye sobre él.
 */

export type VinculoInfluencia =
  | "hijo_de"
  | "conyuge_de"
  | "hermano_de"
  | "heredero_de"
  | "padre_de"
  | "abogado_de"
  | "gestor_de"
  | "representante_de"
  | "apoderado_de"
  | "socio_de"
  | "otro_vinculo";

/** Vínculos que ofrecemos en el desplegable, en el orden en que se usan. */
export const VINCULOS: Array<{ valor: VinculoInfluencia; etiqueta: string }> = [
  { valor: "hijo_de", etiqueta: "Hijo/a" },
  { valor: "conyuge_de", etiqueta: "Cónyuge" },
  { valor: "hermano_de", etiqueta: "Hermano/a" },
  { valor: "padre_de", etiqueta: "Padre/madre" },
  { valor: "heredero_de", etiqueta: "Heredero/a" },
  { valor: "abogado_de", etiqueta: "Abogado" },
  { valor: "gestor_de", etiqueta: "Gestor / administrador" },
  { valor: "representante_de", etiqueta: "Representante" },
  { valor: "apoderado_de", etiqueta: "Apoderado" },
  { valor: "socio_de", etiqueta: "Socio" },
  { valor: "otro_vinculo", etiqueta: "Otro vínculo" },
];

const POSESIVO: Record<VinculoInfluencia, string> = {
  hijo_de: "su hijo/a",
  conyuge_de: "su cónyuge",
  hermano_de: "su hermano/a",
  padre_de: "su padre/madre",
  heredero_de: "su heredero/a",
  abogado_de: "su abogado",
  gestor_de: "su gestor",
  representante_de: "su representante",
  apoderado_de: "su apoderado",
  socio_de: "su socio",
  otro_vinculo: "persona de su entorno",
};

/** «su hija», «su abogado»… en lenguaje llano, tal cual lo lee el comercial. */
export function textoVinculo(v: unknown): string {
  const k = String(v ?? "") as VinculoInfluencia;
  return POSESIVO[k] ?? POSESIVO.otro_vinculo;
}

export function etiquetaVinculo(v: unknown): string {
  const k = String(v ?? "");
  return VINCULOS.find((x) => x.valor === k)?.etiqueta ?? "Otro vínculo";
}

export type InfluenciadorFila = {
  relation_id?: string | null;
  owner_id: string;
  nombre?: string | null;
  telefono?: string | null;
  email?: string | null;
  relation_type?: unknown;
  source?: string | null;
  notes?: string | null;
};

/**
 * Línea de una sola lectura: «Ana Domingo Gutiérrez — su hija — 6XX…».
 * Nunca inventa: si falta el teléfono lo dice.
 */
export function lineaInfluenciador(f: InfluenciadorFila): string {
  const nombre = String(f.nombre ?? "").trim() || "Sin nombre";
  const tel = String(f.telefono ?? "").trim();
  return `${nombre} — ${textoVinculo(f.relation_type)} — ${tel || "sin teléfono"}`;
}

/** De dónde sale el dato, para que el comercial sepa cuánto fiarse. */
export function textoOrigen(source: unknown): string {
  const s = String(source ?? "").trim().toLowerCase();
  if (s === "hubspot" || s === "hubspot_es_familiar") return "HubSpot";
  if (s === "nota_simple") return "Nota simple";
  if (s === "manual" || s === "comercial") return "Apuntado por un comercial";
  if (s === "apellido") return "Deducido por apellido compartido";
  if (s === "domicilio") return "Deducido por mismo domicilio";
  return "Origen sin especificar";
}

export type OwnerLike = { owner_id: string; nombre?: string | null };

/**
 * Agrupa los influenciadores bajo el propietario al que pertenecen.
 * Los que no tienen propietario asignado caen en el grupo «sin vincular».
 *
 * Mantiene el orden de los propietarios que recibe: la ficha del edificio ya
 * los trae ordenados por sub-score.
 */
export function agrupaPorPropietario(
  propietarios: OwnerLike[],
  influenciadores: Array<InfluenciadorFila & { propietario_owner_id?: string | null }>,
): {
  grupos: Array<{ propietario: OwnerLike; influenciadores: InfluenciadorFila[] }>;
  sinVincular: InfluenciadorFila[];
} {
  const porPropietario = new Map<string, InfluenciadorFila[]>();
  const sinVincular: InfluenciadorFila[] = [];
  for (const inf of influenciadores) {
    const p = inf.propietario_owner_id ? String(inf.propietario_owner_id) : null;
    if (!p) {
      sinVincular.push(inf);
      continue;
    }
    if (!porPropietario.has(p)) porPropietario.set(p, []);
    porPropietario.get(p)!.push(inf);
  }
  const grupos = propietarios
    .filter((p) => (porPropietario.get(String(p.owner_id))?.length ?? 0) > 0)
    .map((p) => ({ propietario: p, influenciadores: porPropietario.get(String(p.owner_id))! }));
  // Un influenciador vinculado a alguien que no está en la lista visible no se
  // pierde: se muestra como no vinculado antes que colgarlo de quien no es.
  const visibles = new Set(propietarios.map((p) => String(p.owner_id)));
  for (const [k, v] of porPropietario) if (!visibles.has(k)) sinVincular.push(...v);
  return { grupos, sinVincular };
}

export const TITULO_SIN_VINCULAR = "Personas relacionadas con el edificio, sin vincular todavía";

export const AYUDA_SIN_VINCULAR =
  "No hay evidencia suficiente para saber sobre quién influyen. Vincúlalas a mano cuando lo sepas: es peor colgarlas del propietario equivocado.";

/**
 * Resumen honesto del resultado de la migración, para reportar al cliente.
 */
export function resumenVinculacion(r: {
  vinculados?: unknown;
  sin_vincular?: unknown;
  ambiguos?: unknown;
}): string {
  const v = Number(r?.vinculados ?? 0);
  const s = Number(r?.sin_vincular ?? 0);
  const a = Number(r?.ambiguos ?? 0);
  const partes = [`${v} vinculados a un propietario concreto`, `${s} sin vincular`];
  if (a > 0) partes.push(`${a} con más de un candidato posible, dejados a revisión`);
  return partes.join(" · ");
}

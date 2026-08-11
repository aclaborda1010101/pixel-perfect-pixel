// COMPLETITUD FAIL-CLOSED (P0.8).
//
// El canario P0.7 materializó 29 de 66 participaciones registrales y aun así
// marcó reparse_done=1: un falso éxito crítico. Aquí se construye, desde el
// texto REAL del PDF y de forma determinista, el INVENTARIO de hechos
// registrales esperados (sólo titularidades/participaciones; nunca cargas,
// hipotecas ni afecciones) y se reconcilia 1:1 contra lo que el LLM devuelve.
//
// Módulo puro: sin Deno, sin red, sin base de datos.

import { normalizeNombre, normalizeDoc, type RolCanonico } from "./lib.ts";
import { candidatosPorcentaje, parsePorcentajeFuente, redondearExacto, type PorcentajeFuente } from "./porcentaje.ts";
import {
  contarTokensParticipacion,
  localizarVentanaRegistral,
  anclarDocumento,
  identidadAntesDelToken,
  type SeccionTipo,
} from "./parsing.ts";

export type { SeccionTipo };

export type HechoEsperado = {
  /** Nombre literal tal y como aparece en la nota (null si es ambiguo). */
  nombre: string | null;
  nombre_norm: string;
  doc: string | null;
  right_type: Extract<RolCanonico, "pleno" | "usufructo" | "nuda_propiedad">;
  /** Literal exacto del porcentaje en la fuente ("0,109649%"). */
  porcentaje_literal: string;
  /** Valor canónico con 6 decimales. */
  porcentaje: number;
  forma: PorcentajeFuente["forma"];
  page: number;
  offset: number;
  /** Rango [inicio,fin) del hecho dentro del texto fuente. */
  range: [number, number];
  locator: string;
  cita: string;
  seccion: SeccionTipo;
  section_reason: string;
  /** true si la identidad textual no se pudo resolver: bloquea el VÍNCULO,
   *  jamás borra el hecho del inventario (P0.11). */
  identidad_ambigua: boolean;
};

export type Inventario = {
  documento: "NOTA_SIMPLE" | "NON_REGISTRY_DOCUMENT";
  hechos: HechoEsperado[];
  /** Participaciones detectadas dentro de cargas/hipotecas: NO son titulares. */
  cargas: number;
  /** Líneas de participación que no pudieron resolverse (bloquean). */
  ambiguos: Array<{ page: number; offset: number; cita: string; motivo: string }>;
  paginas: number;
  /** Diagnóstico durable del parser (nunca se reduce a un string). */
  diagnostico: {
    chars: number;
    saltos_de_linea: number;
    tokens_participacion: number;
    zonas_titularidad: number;
    zonas_cargas: number;
    bloques: number;
  };
};

const RE_CARGAS = /\b(cargas?|hipotec\w*|afecci\w*|embargo\w*|servidumbre\w*|condici[oó]n\s+resolutoria|anotaci[oó]n\s+preventiva)\b/i;
const RE_TITULARIDAD = /\b(titularidad(?:es)?|titulares?|derechos?\s+inscritos?|propiedad(?:es)?\s+inscrita)\b/i;
const RE_DESCRIPCION = /\b(descripci[oó]n|finca|urbana|r[uú]stica)\b/i;

const RE_PARTICIPACION = /\bparticipaci[oó]n\b/i;
const RE_NOTA = /\b(registro\s+de\s+la\s+propiedad|nota\s+simple|informativa\s+registral|folio\s+real|idufir|c\.?r\.?u\.?)\b/i;

/** Clasificación determinista de una cabecera de sección. */
export function clasificarSeccion(linea: string): SeccionTipo | null {
  const l = linea.trim();
  if (!l || l.length > 120) return null;
  // Una línea de HECHO (lleva participación, coma o más de 6 palabras) nunca
  // es cabecera de sección: "TITULAR: X, PARTICIPACION 5%" es un hecho.
  if (RE_PARTICIPACION.test(l) || l.includes(",") || l.split(/\s+/).length > 6) return null;
  const esCabecera = l === l.toUpperCase() || /:\s*$/.test(l);
  if (!esCabecera) return null;
  if (RE_CARGAS.test(l)) return "cargas";
  if (RE_TITULARIDAD.test(l)) return "titularidad";
  if (RE_DESCRIPCION.test(l)) return "descripcion";
  return null;
}

export function derechoDe(texto: string): HechoEsperado["right_type"] | null {
  const t = texto.toLowerCase();
  if (/nuda\s+propiedad|nuda-propiedad/.test(t)) return "nuda_propiedad";
  if (/usufructo/.test(t)) return "usufructo";
  if (/pleno\s+dominio|plena\s+propiedad|propiedad\s+plena|pleno\b/.test(t)) return "pleno";
  return null;
}


/**
 * INVENTARIO DETERMINISTA de hechos registrales desde el texto crudo.
 * Recorre el documento por páginas y secciones; sólo las secciones de
 * titularidad producen hechos esperados. Cada hecho lleva identidad, derecho,
 * porcentaje literal y localizador (página + offset + rango + cita).
 */
export function extraerInventario(texto: string | null | undefined): Inventario {
  const src = String(texto ?? "");
  const tokens = contarTokensParticipacion(src);
  const inv: Inventario = {
    documento: RE_NOTA.test(src) ? "NOTA_SIMPLE" : "NON_REGISTRY_DOCUMENT",
    hechos: [],
    cargas: 0,
    ambiguos: [],
    paginas: 0,
    diagnostico: {
      chars: src.length,
      saltos_de_linea: (src.match(/\n/g) ?? []).length,
      tokens_participacion: tokens,
      zonas_titularidad: 0,
      zonas_cargas: 0,
      bloques: 0,
    },
  };
  if (!src.trim()) return inv;

  // ANCLAJE POR TOKEN (P0.11): cada PARTICIPACION es el ancla de un hecho.
  const { paginas, zonas, anclajes } = anclarDocumento(src);
  const ventana = localizarVentanaRegistral(src);
  inv.paginas = paginas.length ? Math.max(...paginas.map((p) => p.page)) : 0;
  inv.diagnostico.zonas_titularidad = zonas.filter((z) => z.seccion === "titularidad").length;
  inv.diagnostico.zonas_cargas = zonas.filter((z) => z.seccion === "cargas").length;
  inv.diagnostico.bloques = anclajes.length;

  const vistos = new Set<number>();
  for (const a of anclajes) {
    const page = a.page;
    const offset = a.token;

    // Una participación fuera de titularidad es carga/afección: NO es titular.
    if (a.seccion !== "titularidad") {
      inv.cargas += 1;
      continue;
    }
    if (vistos.has(offset)) {
      inv.ambiguos.push({ page, offset, cita: "", motivo: "offset_duplicado" });
      continue;
    }
    vistos.add(offset);

    const tramo = src.slice(a.hecho[0], a.hecho[1]);
    const tramoIdentidad = src.slice(a.identidad[0], a.identidad[1]);
    const cita = `${tramoIdentidad.slice(-160).trim()} ${tramo.trim()}`.replace(/\s+/g, " ").slice(0, 700);

    const candidatos = candidatosPorcentaje(tramo);
    if (candidatos.length === 0) {
      inv.ambiguos.push({ page, offset, cita, motivo: "participacion_sin_porcentaje" });
      continue;
    }
    // Varios porcentajes DENTRO del tramo del hecho (antes de TITULO:) es
    // ambigüedad real: no se elige por conveniencia, bloquea.
    if (candidatos.length > 1) {
      inv.ambiguos.push({ page, offset, cita, motivo: "participacion_con_varios_porcentajes" });
      continue;
    }
    const derecho = derechoDe(tramo);
    if (!derecho) {
      inv.ambiguos.push({ page, offset, cita, motivo: "participacion_sin_derecho" });
      continue;
    }
    // El porcentaje del hecho es el literal INMEDIATAMENTE posterior al token.
    const elegido = candidatos[0];
    const ident = identidadAntesDelToken(tramoIdentidad);
    const nombre = ident.nombre;
    inv.hechos.push({
      nombre,
      nombre_norm: nombre ? normalizeNombre(nombre) : "",
      doc: ident.doc ? normalizeDoc(ident.doc) : null,
      right_type: derecho,
      porcentaje_literal: elegido.literal,
      porcentaje: elegido.valor,
      forma: elegido.forma,
      page,
      offset,
      range: [a.identidad[0], a.hecho[1]],
      locator: `p${page}:o${offset}`,
      cita,
      seccion: a.seccion,
      section_reason: ventana?.razon_fin ?? "ventana_registral_ausente",
      identidad_ambigua: !nombre,
    });
  }

  // FAIL-CLOSED: un documento registral con tokens PARTICIPACION que no
  // produce inventario NO es "no registral" ni "completo": es un fallo del
  // parser y debe bloquear con diagnóstico.
  if (tokens > 0 && inv.hechos.length === 0 && inv.ambiguos.length === 0) {
    inv.documento = "NOTA_SIMPLE";
    inv.ambiguos.push({
      page: 0,
      offset: 0,
      cita: src.slice(0, 160),
      motivo: `inventario_vacio_con_participaciones:${tokens}`,
    });
  }
  const clasificados = inv.hechos.length + inv.cargas + inv.ambiguos.length;
  if (tokens > 0 && clasificados !== tokens) {
    inv.ambiguos.push({ page: 0, offset: 0, cita: "", motivo: `tokens_sin_clasificar:${tokens - clasificados}` });
  }
  return inv;
}

export type Capas = { pleno: number; nuda_propiedad: number; usufructo: number };

export function contarCapas(items: Array<{ right_type?: string; rol?: string }>): Capas {
  const c: Capas = { pleno: 0, nuda_propiedad: 0, usufructo: 0 };
  for (const i of items) {
    const k = String(i.right_type ?? i.rol ?? "");
    if (k === "pleno" || k === "nuda_propiedad" || k === "usufructo") c[k] += 1;
  }
  return c;
}

/** Clave 1:1 de un hecho: identidad + derecho + porcentaje EXACTO (6 dec.). */
export function hechoKey(h: { nombre_norm?: string; nombre?: string; right_type?: string; rol?: string; porcentaje?: number | null }): string {
  const nombre = h.nombre_norm ?? normalizeNombre(h.nombre ?? "");
  const derecho = String(h.right_type ?? h.rol ?? "");
  const pct = typeof h.porcentaje === "number" ? redondearExacto(h.porcentaje).toFixed(6) : "null";
  return `${nombre}|${derecho}|${pct}`;
}

export type Completitud = {
  ok: boolean;
  documento: Inventario["documento"];
  expected: number;
  materialized: number;
  capas_esperadas: Capas;
  capas_materializadas: Capas;
  faltantes: string[];
  sobrantes: string[];
  duplicados: string[];
  ambiguos: Inventario["ambiguos"];
  cargas_excluidas: number;
  motivo: string | null;
};

/**
 * RECONCILIACIÓN 1:1. Sólo devuelve ok=true si TODOS los hechos esperados
 * están materializados exactamente una vez, no hay filas extra, no hay
 * ambigüedades y los conteos por capa coinciden.
 */
export function reconciliarCompletitud(args: {
  inventario: Inventario;
  materializados: Array<{ nombre: string; rol: string; porcentaje: number | null }>;
}): Completitud {
  const inv = args.inventario;
  const esperados = inv.hechos;
  const capas_esperadas = contarCapas(esperados);
  const capas_materializadas = contarCapas(args.materializados.map((m) => ({ rol: m.rol })));

  const cuentaEsperada = new Map<string, number>();
  for (const h of esperados) cuentaEsperada.set(hechoKey(h), (cuentaEsperada.get(hechoKey(h)) ?? 0) + 1);
  const cuentaMaterial = new Map<string, number>();
  for (const m of args.materializados) {
    const k = hechoKey({ nombre: m.nombre, rol: m.rol, porcentaje: m.porcentaje });
    cuentaMaterial.set(k, (cuentaMaterial.get(k) ?? 0) + 1);
  }

  const faltantes: string[] = [];
  const sobrantes: string[] = [];
  const duplicados: string[] = [];
  for (const [k, n] of cuentaEsperada) {
    const m = cuentaMaterial.get(k) ?? 0;
    for (let i = m; i < n; i++) faltantes.push(k);
    if (m > n) duplicados.push(`${k} x${m}`);
  }
  for (const [k, m] of cuentaMaterial) {
    const n = cuentaEsperada.get(k) ?? 0;
    for (let i = n; i < m; i++) sobrantes.push(k);
  }

  const capasOk =
    capas_esperadas.pleno === capas_materializadas.pleno &&
    capas_esperadas.nuda_propiedad === capas_materializadas.nuda_propiedad &&
    capas_esperadas.usufructo === capas_materializadas.usufructo;

  let motivo: string | null = null;
  if (inv.documento === "NON_REGISTRY_DOCUMENT") motivo = "NON_REGISTRY_DOCUMENT";
  else if (inv.ambiguos.length) motivo = `inventario_ambiguo:${inv.ambiguos[0].motivo}`;
  else if (esperados.length === 0) motivo = "inventario_vacio";
  else if (sobrantes.length && args.materializados.length > esperados.length) motivo = `completeness_filas_extra:${sobrantes.length}`;
  else if (faltantes.length) motivo = `completeness_incompleta:faltan_${faltantes.length}`;
  else if (sobrantes.length) motivo = `completeness_filas_extra:${sobrantes.length}`;
  else if (duplicados.length) motivo = `completeness_duplicados:${duplicados.length}`;
  else if (!capasOk) motivo = "completeness_capas_desiguales";

  return {
    ok: motivo == null,
    documento: inv.documento,
    expected: esperados.length,
    materialized: args.materializados.length,
    capas_esperadas,
    capas_materializadas,
    faltantes: faltantes.slice(0, 50),
    sobrantes: sobrantes.slice(0, 50),
    duplicados: duplicados.slice(0, 50),
    ambiguos: inv.ambiguos.slice(0, 20),
    cargas_excluidas: inv.cargas,
    motivo,
  };
}

/** ¿Es un documento que ni siquiera es una nota simple? (0 titulares, sin retry) */
export function esDocumentoNoRegistral(texto: string | null | undefined): boolean {
  return extraerInventario(texto).documento === "NON_REGISTRY_DOCUMENT";
}

export { parsePorcentajeFuente };

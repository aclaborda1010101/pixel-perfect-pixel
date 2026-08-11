// PARSER REGISTRAL INDEPENDIENTE DE SALTOS DE LÍNEA (P0.9).
//
// El canario real (nota 71c01af3…) trae 27.574 caracteres, 12 marcadores de
// página y CERO "\n": cualquier parser basado en split(/\n/) ve UNA sola línea
// y devuelve 0 hechos. Aquí se tokeniza por OFFSETS: marcadores de página,
// encabezados de sección (aunque estén pegados al texto anterior) y bloques
// semánticos de hecho. Nada de normalizar ni inyectar saltos artificiales.
//
// Módulo puro: sin Deno, sin red, sin base de datos.

export type SeccionTipo = "titularidad" | "cargas" | "descripcion" | "otro";

export type Pagina = { page: number; inicio: number; fin: number };
export type Zona = { seccion: SeccionTipo; inicio: number; fin: number; encabezado: string; razon?: string };
export type Bloque = {
  texto: string;
  inicio: number;
  fin: number;
  page: number;
  seccion: SeccionTipo;
};

/** Marcadores de página por POSICIÓN (no por línea). */
const RE_PAGINA_MARCA = /\f|(?:-{0,3}\s*)?P[áa]g(?:ina)?\.?\s*(\d{1,3})(?:\s*(?:de|\/)\s*\d{1,3})?/gi;

/** Sólo cabeceras estructurales; palabras narrativas nunca cambian sección. */
const RE_TITULARIDADES_HEADER = /(?:MAPA\s+DE\s+)?TITULARIDADES?\s*:?/g;
const RE_CARGAS_HEADER = /CARGAS(?:\s+Y\s+GRAV[ÁA]MENES)?\s*:?/g;

export const RE_PARTICIPACION_G = /PARTICIPACI[ÓO]N/gi;

export type VentanaRegistral = {
  inicio: number;
  fin: number;
  titularidades_header: [number, number];
  cargas_header: [number, number] | null;
  razon_inicio: "cabecera_titularidades";
  razon_fin: "cabecera_cargas_estructural" | "fin_documento_sin_cargas";
};

function primera(re: RegExp, src: string, desde = 0): RegExpExecArray | null {
  re.lastIndex = desde;
  return re.exec(src);
}

/** Ventana inequívoca [fin cabecera TITULARIDADES, inicio cabecera CARGAS). */
export function localizarVentanaRegistral(src: string): VentanaRegistral | null {
  const titular = primera(RE_TITULARIDADES_HEADER, src);
  if (!titular) return null;
  const cargas = primera(RE_CARGAS_HEADER, src, titular.index + titular[0].length);
  return {
    inicio: titular.index + titular[0].length,
    fin: cargas?.index ?? src.length,
    titularidades_header: [titular.index, titular.index + titular[0].length],
    cargas_header: cargas ? [cargas.index, cargas.index + cargas[0].length] : null,
    razon_inicio: "cabecera_titularidades",
    razon_fin: cargas ? "cabecera_cargas_estructural" : "fin_documento_sin_cargas",
  };
}

/** Páginas por posición. Siempre devuelve al menos una página cubriendo todo. */
export function segmentarPaginas(src: string): Pagina[] {
  const marcas: Array<{ idx: number; page: number | null; len: number }> = [];
  RE_PAGINA_MARCA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_PAGINA_MARCA.exec(src))) {
    const n = m[1] ? Number(m[1]) : null;
    marcas.push({ idx: m.index, page: Number.isInteger(n as number) && (n as number) > 0 ? n : null, len: m[0].length });
  }
  if (marcas.length === 0) return [{ page: 1, inicio: 0, fin: src.length }];

  const paginas: Pagina[] = [];
  let page = marcas[0].idx > 0 ? (marcas[0].page ?? 1) : (marcas[0].page ?? 1);
  let cursor = 0;
  let actual = marcas[0].page ?? 1;
  if (marcas[0].idx > 0) {
    // Texto antes del primer marcador: pertenece a la página anterior (o 1).
    const primera = Math.max(1, (marcas[0].page ?? 2) - 1);
    paginas.push({ page: primera, inicio: 0, fin: marcas[0].idx + marcas[0].len });
  }
  for (let i = 0; i < marcas.length; i++) {
    const marca = marcas[i];
    actual = marca.page ?? (actual + 1);
    cursor = marca.idx + marca.len;
    const fin = i + 1 < marcas.length ? marcas[i + 1].idx + marcas[i + 1].len : src.length;
    paginas.push({ page: actual, inicio: cursor, fin });
  }
  void page;
  return paginas.filter((p) => p.fin > p.inicio);
}

export function paginaDe(paginas: Pagina[], offset: number): number {
  for (const p of paginas) if (offset >= p.inicio && offset < p.fin) return p.page;
  return paginas.length ? paginas[paginas.length - 1].page : 1;
}

/** Zonas de sección por posición: CARGAS/HIPOTECAS excluyen sus participaciones. */
export function segmentarSecciones(src: string): Zona[] {
  const v = localizarVentanaRegistral(src);
  if (!v) return [{ seccion: "otro", inicio: 0, fin: src.length, encabezado: "", razon: "ventana_registral_ausente" }];
  const out: Zona[] = [];
  if (v.titularidades_header[0] > 0) out.push({ seccion: "otro", inicio: 0, fin: v.titularidades_header[0], encabezado: "", razon: "antes_titularidades" });
  out.push({ seccion: "titularidad", inicio: v.inicio, fin: v.fin, encabezado: src.slice(...v.titularidades_header), razon: v.razon_fin });
  if (v.cargas_header) {
    out.push({ seccion: "cargas", inicio: v.cargas_header[1], fin: src.length, encabezado: src.slice(...v.cargas_header), razon: v.razon_fin });
  }
  return out;
}

/**
 * Bloques semánticos: CADA token PARTICIPACION abre un hecho y termina justo
 * antes del siguiente token (o al final de la sección). No depende de líneas,
 * guiones, TITULAR: ni de separadores editoriales.
 */
export function segmentarBloques(src: string, zona: Zona, paginas: Pagina[]): Bloque[] {
  const trozo = src.slice(zona.inicio, zona.fin);
  const arranques: number[] = [];
  RE_PARTICIPACION_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_PARTICIPACION_G.exec(trozo))) arranques.push(m.index);

  const out: Bloque[] = [];
  for (let i = 0; i < arranques.length; i++) {
    const token = arranques[i];
    const previo = i === 0 ? 0 : arranques[i - 1] + "PARTICIPACION".length;
    const a = Math.max(previo, token - 320);
    const b = i + 1 < arranques.length ? arranques[i + 1] : trozo.length;
    const inicio = zona.inicio + a;
    out.push({ texto: trozo.slice(a, b), inicio, fin: zona.inicio + b, page: paginaDe(paginas, zona.inicio + token), seccion: zona.seccion });
  }
  return out;
}

/** Todos los bloques del documento, en orden de aparición. */
export function tokenizarDocumento(src: string): { paginas: Pagina[]; zonas: Zona[]; bloques: Bloque[] } {
  const paginas = segmentarPaginas(src);
  const zonas = segmentarSecciones(src);
  const bloques: Bloque[] = [];
  for (const z of zonas) bloques.push(...segmentarBloques(src, z, paginas));
  bloques.sort((a, b) => a.inicio - b.inicio);
  return { paginas, zonas, bloques };
}

/** Número total de tokens PARTICIPACION del documento (todas las secciones). */
export function contarTokensParticipacion(src: string): number {
  RE_PARTICIPACION_G.lastIndex = 0;
  return (src.match(RE_PARTICIPACION_G) ?? []).length;
}

// ---------- extracción completa por páginas (nunca slice(0,60000)) ----------

export type Chunk = { page: number; index: number; inicio: number; fin: number; texto: string };
export type Extracto = {
  chunks: Chunk[];
  /** Caracteres cubiertos por los chunks (sin contar el solape). */
  cubiertos: number;
  total: number;
  /** true si alguna parte del documento se quedó fuera: BLOQUEA la finalización. */
  truncado: boolean;
  paginas: number;
};

export const CHUNK_MAX = 12000;
export const CHUNK_SOLAPE = 400;

/**
 * Trocea el texto COMPLETO por páginas con solape, con id de página y offsets.
 * `truncado` sólo puede ser true si el documento excede el tope duro global.
 */
export function construirExtracto(src: string, opts?: { maxChars?: number; solape?: number; topeGlobal?: number }): Extracto {
  const texto = String(src ?? "");
  const max = Math.max(1000, opts?.maxChars ?? CHUNK_MAX);
  const solape = Math.max(0, opts?.solape ?? CHUNK_SOLAPE);
  const tope = opts?.topeGlobal ?? 1_000_000;
  const paginas = segmentarPaginas(texto);
  const chunks: Chunk[] = [];
  let cubiertos = 0;
  let index = 0;
  for (const p of paginas) {
    let cursor = p.inicio;
    while (cursor < p.fin) {
      const fin = Math.min(p.fin, cursor + max);
      chunks.push({ page: p.page, index: index++, inicio: cursor, fin, texto: texto.slice(cursor, fin) });
      cubiertos += fin - cursor;
      if (fin >= p.fin) break;
      cursor = Math.max(cursor + 1, fin - solape);
    }
  }
  return {
    chunks,
    cubiertos,
    total: texto.length,
    truncado: texto.length > tope,
    paginas: paginas.length ? Math.max(...paginas.map((p) => p.page)) : 0,
  };
}

/** Serializa el extracto con IDs de página/offset para el prompt. */
export function extractoParaPrompt(e: Extracto): string {
  return e.chunks
    .map((c) => `[[pagina=${c.page} offset=${c.inicio}-${c.fin}]]\n${c.texto}`)
    .join("\n\n");
}

export type EstadoTexto =
  | { ok: true; chars: number }
  | { ok: false; estado: "no_evaluable"; reason: "OCR_required"; chars: number };

/** PDF sin capa de texto: no_evaluable / OCR_required. Jamás reparse_done. */
export function estadoTextoFuente(raw: string | null | undefined, minimo = 200): EstadoTexto {
  const chars = String(raw ?? "").trim().length;
  if (chars >= minimo) return { ok: true, chars };
  return { ok: false, estado: "no_evaluable", reason: "OCR_required", chars };
}

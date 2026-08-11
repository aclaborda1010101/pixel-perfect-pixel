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

/** Cabecera del título de adquisición: cierra el tramo del hecho (P0.11). */
export const RE_TITULO_G = /TITULO\s*:|T[ÍI]TULO\s*:/gi;

/**
 * P0.11 · TRAMO DEL HECHO. Para cada token PARTICIPACION el hecho vive desde
 * el propio token hasta el primer "TITULO:" o el siguiente PARTICIPACION, lo
 * que ocurra ANTES. Nunca una ventana de N caracteres arbitraria: eso alcanza
 * porcentajes históricos del título de adquisición o del titular siguiente.
 */
export type Anclaje = {
  /** Offset absoluto del token PARTICIPACION. */
  token: number;
  /** [inicio,fin) del tramo del hecho (arranca en el token). */
  hecho: [number, number];
  /** [inicio,fin) del tramo de identidad, SIEMPRE anterior al token. */
  identidad: [number, number];
  page: number;
  seccion: SeccionTipo;
  /** Motivo del corte del tramo del hecho. */
  corte: "titulo" | "siguiente_participacion" | "fin_zona";
};

function indices(re: RegExp, src: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** Anclajes de una zona: uno por token PARTICIPACION, en orden documental. */
export function anclarParticipaciones(src: string, zona: Zona, paginas: Pagina[]): Anclaje[] {
  const trozo = src.slice(zona.inicio, zona.fin);
  const tokens = indices(RE_PARTICIPACION_G, trozo);
  const titulos = indices(RE_TITULO_G, trozo);
  const out: Anclaje[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const [tIni, tFin] = tokens[i];
    const siguiente = i + 1 < tokens.length ? tokens[i + 1][0] : trozo.length;
    const tituloDespues = titulos.find(([a]) => a > tIni)?.[0] ?? Infinity;
    const fin = Math.min(siguiente, tituloDespues === Infinity ? trozo.length : tituloDespues);
    const corte: Anclaje["corte"] =
      fin === tituloDespues ? "titulo" : (i + 1 < tokens.length && fin === siguiente ? "siguiente_participacion" : "fin_zona");

    // Identidad: hacia ATRÁS hasta el final del TITULO anterior, el token
    // PARTICIPACION anterior o el arranque de la página, lo que esté más cerca.
    const tituloAntes = titulos.filter(([, b]) => b <= tIni).map(([, b]) => b).pop() ?? 0;
    const tokenAntes = i > 0 ? tokens[i - 1][1] : 0;
    const absToken = zona.inicio + tIni;
    const pag = paginas.find((p) => absToken >= p.inicio && absToken < p.fin);
    const pagInicio = pag ? Math.max(0, pag.inicio - zona.inicio) : 0;
    const idIni = Math.max(tituloAntes, tokenAntes, pagInicio, 0);
    out.push({
      token: absToken,
      hecho: [absToken, zona.inicio + fin],
      identidad: [zona.inicio + Math.min(idIni, tIni), absToken],
      page: paginaDe(paginas, absToken),
      seccion: zona.seccion,
      corte,
    });
    void tFin;
  }
  return out;
}

/** Todos los anclajes del documento (todas las zonas), en orden. */
export function anclarDocumento(src: string): { paginas: Pagina[]; zonas: Zona[]; anclajes: Anclaje[] } {
  const paginas = segmentarPaginas(src);
  const zonas = segmentarSecciones(src);
  const anclajes: Anclaje[] = [];
  for (const z of zonas) anclajes.push(...anclarParticipaciones(src, z, paginas));
  anclajes.sort((a, b) => a.token - b.token);
  return { paginas, zonas, anclajes };
}

// ---------- identidad ANTES del token ----------

const RE_DOC_G = /\b(\d{8}[A-Za-z]|[A-Za-z]\d{7}[A-Za-z0-9]|[A-Za-z]-?\d{8})\b/g;
const RUIDO = new Set([
  "TOMO", "LIBRO", "FOLIO", "INSCRIPCION", "INSCRIPCIÓN", "FINCA", "PAGINA", "PÁGINA",
  "NUMERO", "NÚMERO", "NUM", "Nº", "N", "REGISTRO", "IDUFIR",
  "CRU", "SECCION", "SECCIÓN", "ALTA", "DNI", "NIF", "CIF", "NIE", "DON", "DOÑA",
  "TITULAR", "TITULARES", "HOJA", "ASIENTO", "DIARIO",
]);
const RE_PALABRA_NOMBRE = /^[A-ZÁÉÍÓÚÑÜÇ][A-ZÁÉÍÓÚÑÜÇ'’\-\.]*,?$/;

export type Identidad = { nombre: string | null; doc: string | null; motivo?: string };

/**
 * Última identidad válida ANTES del token: se toma el último DNI/CIF del tramo
 * y el nombre inmediatamente precedente, ignorando el ruido numérico registral
 * (tomo/libro/folio/inscripción). Sin DNI se admite el nombre en mayúsculas
 * inmediatamente anterior (sociedades incluidas).
 */
export function identidadAntesDelToken(tramo: string): Identidad {
  const docs: Array<{ doc: string; index: number }> = [];
  RE_DOC_G.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_DOC_G.exec(tramo))) docs.push({ doc: m[1], index: m.index });
  const ultimo = docs.length ? docs[docs.length - 1] : null;
  const zona = ultimo ? tramo.slice(0, ultimo.index) : tramo;
  const nombre = nombreAlFinal(zona);
  if (!nombre && !ultimo) return { nombre: null, doc: null, motivo: "identidad_no_localizada" };
  return { nombre, doc: ultimo?.doc ?? null, motivo: nombre ? undefined : "nombre_no_localizado" };
}

function nombreAlFinal(zona: string): string | null {
  const tokens = zona.trim().split(/\s+/).filter(Boolean);
  let i = tokens.length - 1;
  // Se salta el ruido registral pegado al final (números y palabras de ruido).
  let saltos = 0;
  while (i >= 0 && saltos < 8) {
    const t = tokens[i].replace(/[.,;:]+$/, "");
    if (/^[\d.\-\/]+$/.test(t) || RUIDO.has(t.toUpperCase()) && !RE_PALABRA_NOMBRE.test(t)) {
      i--; saltos++; continue;
    }
    break;
  }
  const partes: string[] = [];
  while (i >= 0 && partes.length < 8) {
    const t = tokens[i];
    const limpio = t.replace(/^[^A-ZÁÉÍÓÚÑÜÇ0-9]+/, "");
    if (!RE_PALABRA_NOMBRE.test(limpio)) break;
    if (RUIDO.has(limpio.replace(/[.,]/g, "").toUpperCase())) break;
    partes.unshift(limpio);
    i--;
  }
  const nombre = partes.join(" ").replace(/\s+/g, " ").replace(/^[,\s]+|[,\s]+$/g, "").trim();
  if (nombre.replace(/[^A-ZÁÉÍÓÚÑÜÇ]/g, "").length < 3) return null;
  return nombre;
}

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
  const ordenados = chunks.slice().sort((a, b) => a.inicio - b.inicio);
  let frontera = 0;
  for (const c of ordenados) {
    if (c.inicio > frontera) break;
    frontera = Math.max(frontera, c.fin);
  }
  return {
    chunks,
    cubiertos: frontera,
    total: texto.length,
    truncado: texto.length > tope || frontera < texto.length,
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

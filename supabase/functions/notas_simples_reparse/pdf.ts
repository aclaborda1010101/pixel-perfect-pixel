// Validación REAL del binario antes de gastar un LLM (P0.7).
// Puro y total: no lanza nunca, no depende de Deno ni de red.
// El contador de páginas se INYECTA (unpdf en producción) para poder testear
// sin el motor PDF; si no se inyecta se usa una heurística conservadora.

export const PDF_MAGIC = "%PDF-";
/** Un PDF real de una nota simple nunca pesa menos que esto. */
export const MIN_PDF_BYTES = 512;
/** Tope determinista de tamaño que se manda al modelo. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Tope determinista de páginas por envío documental. */
export const MAX_DOC_PAGES = 40;

export type PdfInspection = {
  ok: boolean;
  /** Motivo exacto del rechazo (null si ok). */
  reason: string | null;
  size: number;
  pageCount: number | null;
  encrypted: boolean;
  header: string;
  sha256: string | null;
};

export type PageCounter = (bytes: Uint8Array) => Promise<number | null>;

function ascii(bytes: Uint8Array, from: number, len: number): string {
  let s = "";
  for (let i = from; i < Math.min(bytes.length, from + len); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** El header %PDF- debe aparecer en los primeros 1024 bytes (tolerancia del estándar). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 1024).includes(PDF_MAGIC);
}

export function detectEncrypted(bytes: Uint8Array): boolean {
  // /Encrypt sólo puede aparecer en el trailer: se busca en la cola del fichero.
  const tail = ascii(bytes, Math.max(0, bytes.length - 4096), 4096);
  return /\/Encrypt\b/.test(tail);
}

/** Heurística (sólo fallback): cuenta objetos /Type /Page que no sean /Pages. */
export function countPagesHeuristic(bytes: Uint8Array): number | null {
  const txt = ascii(bytes, 0, Math.min(bytes.length, 4 * 1024 * 1024));
  const m = txt.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const c: any = (globalThis as any).crypto;
    if (!c?.subtle) return null;
    const buf = await c.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * Inspección total: magic, tamaño, cifrado y número REAL de páginas.
 * Nunca lanza: cualquier excepción del contador se traduce a pdf_sin_paginas.
 */
export async function inspectPdf(
  bytes: Uint8Array | null | undefined,
  opts?: { countPages?: PageCounter; maxBytes?: number },
): Promise<PdfInspection> {
  const b = bytes ?? new Uint8Array(0);
  const size = b.length;
  const header = ascii(b, 0, 8);
  const base: PdfInspection = { ok: false, reason: null, size, pageCount: null, encrypted: false, header, sha256: null };
  const sha256 = await sha256Hex(b);
  base.sha256 = sha256;

  if (size === 0) return { ...base, reason: "pdf_vacio" };
  if (!looksLikePdf(b)) return { ...base, reason: "pdf_no_es_pdf" };
  if (size < MIN_PDF_BYTES) return { ...base, reason: "pdf_truncado" };
  const maxBytes = opts?.maxBytes ?? MAX_PDF_BYTES;
  if (size > maxBytes) return { ...base, reason: "pdf_demasiado_grande" };
  const encrypted = detectEncrypted(b);
  if (encrypted) return { ...base, encrypted: true, reason: "pdf_cifrado" };

  let pages: number | null = null;
  try {
    pages = opts?.countPages ? await opts.countPages(b) : countPagesHeuristic(b);
  } catch {
    pages = null;
  }
  if (pages == null || !Number.isFinite(pages) || pages <= 0) {
    return { ...base, encrypted: false, pageCount: pages ?? null, reason: "pdf_sin_paginas" };
  }
  return { ok: true, reason: null, size, pageCount: pages, encrypted: false, header, sha256 };
}

/** ¿Cabe entero en un único envío documental? (límite determinista) */
export function fitsSingleDocument(insp: PdfInspection): boolean {
  return insp.ok && (insp.pageCount ?? 0) <= MAX_DOC_PAGES && insp.size <= MAX_PDF_BYTES;
}

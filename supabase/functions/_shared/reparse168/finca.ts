// IDENTIDAD DE LA FINCA Y FECHA DE EMISIÓN (dedupe de versiones de una nota).
// Módulo puro.

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

/** CRU (identificador único) o, en su defecto, "FINCA DE <registro> Nº <n>". */
export function claveFinca(raw: string): string | null {
  const src = String(raw ?? "");
  const cru = /CRU\s*:?\s*(\d{10,20})/i.exec(src);
  if (cru) return `CRU:${cru[1]}`;
  const finca = /FINCA\s+DE\s+([A-ZÁÉÍÓÚÑ\s.\-]{3,40}?)\s*N[ºo°]?\s*:?\s*(\d{1,7})/i.exec(src);
  if (finca) return `FINCA:${finca[1].replace(/\s+/g, " ").trim().toUpperCase()}:${finca[2]}`;
  return null;
}

/**
 * TODAS las señales de identidad de la nota (CRU y número de finca). Una nota
 * puede traer sólo una de las dos: dos versiones de la misma finca comparten
 * al menos una señal, y por ahí se unen.
 */
export function señalesFinca(raw: string): string[] {
  const src = String(raw ?? "");
  const out: string[] = [];
  const cru = /CRU\s*:?\s*(\d{10,20})/i.exec(src);
  if (cru) out.push(`CRU:${cru[1]}`);
  const finca = /FINCA\s+DE\s+([A-ZÁÉÍÓÚÑ\s.\-]{3,40}?)\s*N[ºo°]?\s*:?\s*(\d{1,7})/i.exec(src);
  if (finca) out.push(`FINCA:${finca[1].replace(/\s+/g, " ").trim().toUpperCase()}:${finca[2]}`);
  return out;
}

/** Fecha de emisión de la nota (ISO), leída del encabezado registral. */
export function fechaEmision(raw: string): string | null {
  const src = String(raw ?? "");
  const m = /Fecha\s+de\s+Emisi[óo]n\s*:?[^,]{0,40},?\s*(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i.exec(src);
  if (m) {
    const mes = MESES[m[2].toLowerCase()];
    if (mes) return `${m[3]}-${String(mes).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  }
  const d = /Fecha\s+de\s+Emisi[óo]n\s*:?[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/i.exec(src);
  if (d) {
    const anio = d[3].length === 2 ? `20${d[3]}` : d[3];
    return `${anio}-${d[2]}-${d[1]}`;
  }
  return null;
}

export type NotaVersion = { id: string; raw: string; created_at: string };

/**
 * Dedupe por finca: de cada grupo (misma CRU / misma finca) se conserva la de
 * emisión más reciente; empate -> la creada más tarde.
 */
export function elegirVigentes(notas: NotaVersion[]): {
  vigentes: string[];
  descartadas: Array<{ id: string; motivo: string }>;
} {
  // Unión por señal compartida: si dos notas coinciden en CRU o en número de
  // finca, son versiones de la misma finca aunque una omita la otra señal.
  const padre = new Map<string, string>();
  const find = (x: string): string => {
    const p = padre.get(x);
    if (!p || p === x) { padre.set(x, x); return x; }
    const r = find(p); padre.set(x, r); return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) padre.set(rb, ra); };
  for (const n of notas) {
    const nodo = `N:${n.id}`;
    find(nodo);
    // Sin ninguna señal: todas las notas sin identidad del mismo edificio se
    // tratan como versiones de la misma finca (vigente = la más reciente).
    const señales = señalesFinca(n.raw);
    if (!señales.length) union("SIN_CLAVE", nodo);
    for (const s of señales) union(s, nodo);
  }
  const grupos = new Map<string, NotaVersion[]>();
  for (const n of notas) {
    const clave = find(`N:${n.id}`);
    grupos.set(clave, [...(grupos.get(clave) ?? []), n]);
  }
  const vigentes: string[] = [];
  const descartadas: Array<{ id: string; motivo: string }> = [];
  for (const [clave, lista] of grupos) {
    // Cuando la nota no declara fecha de emisión legible se usa la de entrada:
    // comparar contra "" haría ganar siempre a la versión antigua.
    const fechaDe = (n: NotaVersion) => fechaEmision(n.raw) ?? String(n.created_at).slice(0, 10);
    const orden = lista.slice().sort((a, b) => {
      const fa = fechaDe(a), fb = fechaDe(b);
      if (fa !== fb) return fa < fb ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    vigentes.push(orden[0].id);
    for (const resto of orden.slice(1)) {
      descartadas.push({
        id: resto.id,
        motivo: `versión anterior de la misma finca (${clave}); vigente ${orden[0].id} de ${fechaEmision(orden[0].raw) ?? String(orden[0].created_at).slice(0, 10)}`,
      });
    }
  }
  return { vigentes, descartadas };
}

/**
 * Lectura estructurada del texto de una tarjeta de tarea.
 * No cambia nada de lo guardado: solo separa las secciones para pintarlas.
 */

export type SeccionTarjeta = { titulo: string; lineas: string[] };
export type TarjetaTarea = { intro: string[]; secciones: SeccionTarjeta[] };

export const SECCIONES_TARJETA = ["Qué hacer", "Objetivo", "Al terminar"] as const;

/** Corta el texto por los encabezados conocidos, con o sin saltos de línea. */
export function parseTarjetaTarea(description: unknown): TarjetaTarea {
  const texto = typeof description === "string" ? description : "";
  if (!texto.trim()) return { intro: [], secciones: [] };

  const marcas: { titulo: string; inicio: number; fin: number }[] = [];
  for (const titulo of SECCIONES_TARJETA) {
    const idx = texto.indexOf(titulo);
    if (idx >= 0) marcas.push({ titulo, inicio: idx, fin: idx + titulo.length });
  }
  marcas.sort((a, b) => a.inicio - b.inicio);

  const limpiar = (trozo: string) =>
    trozo
      .split(/\n|(?<=\.)\s(?=\d+\.\s)/g)
      .map((l) => l.replace(/^\s*[·•-]\s*/, "").trim())
      .filter((l) => l.length > 0);

  if (marcas.length === 0) return { intro: limpiar(texto), secciones: [] };

  const intro = limpiar(texto.slice(0, marcas[0].inicio));
  const secciones: SeccionTarjeta[] = marcas.map((m, i) => {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].inicio : texto.length;
    return { titulo: m.titulo, lineas: limpiar(texto.slice(m.fin, hasta)) };
  });
  return { intro, secciones };
}

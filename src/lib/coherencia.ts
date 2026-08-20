export type ReglaCoherencia = {
  codigo: string;
  nombre: string;
  explicacion: string;
  n_casos: number;
  error: string | null;
  aceptada: boolean;
  aceptada_motivo: string | null;
  medido_at: string | null;
  historico: { n: number; at: string }[];
};

export type ResumenCoherencia = {
  medido_at: string | null;
  total_incumplimientos: number;
  reglas_en_cero: number;
  reglas: ReglaCoherencia[];
};

/** Cabecera del panel: total, reglas sanas y las tres peores. */
export function cabeceraCoherencia(reglas: ReglaCoherencia[]) {
  const activas = reglas.filter((r) => !r.aceptada && r.n_casos > 0);
  const total = activas.reduce((a, r) => a + r.n_casos, 0);
  const enCero = reglas.filter((r) => r.n_casos === 0).length;
  const peores = [...activas].sort((a, b) => b.n_casos - a.n_casos).slice(0, 3);
  return { total, enCero, peores, conError: reglas.filter((r) => r.n_casos < 0).length };
}

/** "457 → 120 → 12" a partir del histórico (más antiguo primero). */
export function evolucion(historico: { n: number }[], max = 4): string {
  const serie = [...(historico ?? [])].slice(0, max).reverse().map((h) => h.n);
  if (serie.length === 0) return "";
  return serie.join(" → ");
}

/** mejora / empeora / igual comparando la última medición con la anterior. */
export function tendencia(historico: { n: number }[]): "mejora" | "empeora" | "igual" {
  if (!historico || historico.length < 2) return "igual";
  const [ultimo, previo] = [historico[0].n, historico[1].n];
  if (ultimo < previo) return "mejora";
  if (ultimo > previo) return "empeora";
  return "igual";
}

/** Semáforo en lenguaje llano para la cabecera. */
export function saludBase(total: number): { texto: string; tono: "bien" | "atencion" | "mal" } {
  if (total === 0) return { texto: "La base está sana: ninguna regla incumplida.", tono: "bien" };
  if (total < 100) return { texto: "Hay incidencias menores que conviene mirar.", tono: "atencion" };
  return { texto: "Hay incumplimientos importantes que arreglar.", tono: "mal" };
}

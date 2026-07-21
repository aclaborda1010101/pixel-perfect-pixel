import { cn } from "@/lib/utils";

export type ScoreTier = "high" | "mid" | "low";
export type ScoreMode = "total" | "activo";

/**
 * Fuente única para pintar EL score del edificio en cualquier superficie
 * (card del listado, gauge de la ficha, orden, tier, tooltip, etc.).
 *
 * Regla de oro:
 *  - Modo "total" (por defecto): usa `score_total` (activo × propietarios).
 *  - Modo "activo" (toggle "Sin propietarios"): usa `score_activo`.
 *  - Fallback: campo legacy `score`.
 *
 * Todas las superficies DEBEN llamar aquí — nunca leer `b.score` a pelo.
 */
export function getDisplayScore(
  b: { score_total?: any; score_activo?: any; score?: any } | null | undefined,
  mode: ScoreMode = "total",
): number {
  if (!b) return 0;
  const pick = mode === "activo" ? b.score_activo : b.score_total;
  const n = Number(pick);
  if (Number.isFinite(n)) return n;
  // Fallback secundario: si en modo total no hay score_total, prueba score_activo
  if (mode === "total") {
    const na = Number(b.score_activo);
    if (Number.isFinite(na)) return na;
  }
  const legacy = Number(b.score);
  return Number.isFinite(legacy) ? legacy : 0;
}

export function scoreModeLabel(mode: ScoreMode): string {
  return mode === "activo" ? "Activo" : "Total";
}

export function displayScore(raw: number): number {
  return Math.round(Math.max(0, Math.min(100, Number(raw) || 0)));
}

export function scoreTier(score: number): ScoreTier {
  const d = displayScore(score);
  if (d >= 75) return "high";
  if (d >= 50) return "mid";
  return "low";
}

export const tierBarClass: Record<ScoreTier, string> = {
  high: "bg-emerald-500",
  mid: "bg-amber-400",
  low: "bg-red-500",
};

export const tierTextClass: Record<ScoreTier, string> = {
  high: "text-emerald-400",
  mid: "text-amber-400",
  low: "text-red-400",
};

export const tierRingClass: Record<ScoreTier, string> = {
  high: "stroke-emerald-500",
  mid: "stroke-amber-400",
  low: "stroke-red-500",
};

/** Donut gauge for a 0-100 score */
export function ScoreGauge({
  score,
  size = 96,
  thickness = 8,
  label,
}: {
  score: number;
  size?: number;
  thickness?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, score));
  const tier = scoreTier(clamped);
  const displayed = displayScore(clamped);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (displayed / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          className="stroke-surface-1"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          className={cn(tierRingClass[tier], "transition-all duration-500")}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-mono text-2xl font-semibold tabular-nums", tierTextClass[tier])}>
          {displayScore(clamped)}
        </span>
        {label && (
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/** Factor bar: label, colored progress, raw value and points contribution */
export function ScoreFactorBar({
  label,
  value,           // raw human value (e.g. "127 m²")
  pct,             // 0..100 factor score
  pts,             // points contributed to total
  weight,
}: {
  label: string;
  value: React.ReactNode;
  pct: number;
  pts: number;
  weight: number;
}) {
  const tier = scoreTier(pct);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-foreground">{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {value} · <span className={tierTextClass[tier]}>+{pts.toFixed(1)} pts</span>
          <span className="ml-1 text-[10px] opacity-60">/ {weight}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
        <div
          className={cn("h-full transition-all duration-500", tierBarClass[tier])}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

/** Compact mini gauge badge used in list cards.
 *  Renderiza SIEMPRE el score con una etiqueta debajo ("Total" o "Activo")
 *  para que el usuario sepa qué número está viendo. */
export function ScorePill({ score, mode }: { score: number; mode?: ScoreMode }) {
  const tier = scoreTier(score);
  const d = displayScore(score);
  const showLabel = mode !== undefined;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm font-semibold tabular-nums",
          tier === "high" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
          tier === "mid" && "border-amber-400/40 bg-amber-400/10 text-amber-400",
          tier === "low" && "border-red-500/40 bg-red-500/10 text-red-400",
        )}
      >
        {d}
      </div>
      {showLabel && (
        <span className="font-mono text-[8px] uppercase tracking-eyebrow text-muted-foreground">
          {scoreModeLabel(mode!)}
        </span>
      )}
    </div>
  );
}

/** Compute factor breakdown rows from a v_building_score row.
 * Prefiere `score_breakdown` unificado (base + IA cuando hay análisis).
 * Fallback a las columnas `s_*` si por alguna razón el breakdown viene vacío. */
export function buildingScoreFactors(s: any) {
  const bd: any[] = Array.isArray(s?.score_breakdown) ? s.score_breakdown : [];
  if (bd.length > 0) {
    return bd.map((c: any) => {
      const weight = Number(c.peso ?? c.weight ?? 0);
      const pts = Number(
        c.contribucion ??
          (c.pct != null && Number.isFinite(Number(c.pct))
            ? (Number(c.pct) / 100) * Math.abs(weight)
            : 0),
      );
      const pctRaw = weight !== 0 ? (pts / Math.abs(weight)) * 100 : 0;
      const pct = Math.max(0, Math.min(100, pctRaw));
      let raw: string;
      const v = c.valor_raw ?? c.raw ?? null;
      if (v === null || v === undefined) raw = "—";
      else if (typeof v === "boolean") raw = v ? "Sí" : "No";
      else if (typeof v === "number") raw = Number.isFinite(v) ? v.toLocaleString() : "—";
      else raw = String(v);
      return {
        label: String(c.label ?? c.key ?? ""),
        raw,
        pct,
        weight,
        pts,
      };
    });
  }
  // Fallback (legacy)
  const ratio =
    s?.m2_total && s?.num_viviendas
      ? Number(s.m2_total) / Number(s.num_viviendas)
      : null;
  return [
    { label: "Nº viviendas", raw: s?.num_viviendas != null ? String(s.num_viviendas) : "—", pct: Number(s?.s_viviendas ?? 0) * 100, weight: 30 },
    { label: "m² totales", raw: s?.m2_total ? `${Number(s.m2_total).toLocaleString()} m²` : "—", pct: Number(s?.s_m2 ?? 0) * 100, weight: 20 },
    { label: "Ratio m²/vivienda", raw: ratio != null ? `${ratio.toFixed(1)} m²` : "—", pct: Number(s?.s_ratio ?? 0) * 100, weight: 20 },
    { label: "Nº propietarios", raw: s?.owners_count != null ? String(s.owners_count) : "—", pct: Number(s?.s_owners ?? 0) * 100, weight: 20 },
    { label: "Sin división horizontal", raw: s?.division_horizontal ? "No (con DH)" : "Sí", pct: Number(s?.s_no_dh ?? 0) * 100, weight: 10 },
  ].map((f) => ({ ...f, pts: (f.pct / 100) * f.weight }));
}
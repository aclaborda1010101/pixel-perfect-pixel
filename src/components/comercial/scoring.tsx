import { cn } from "@/lib/utils";

export type ScoreTier = "high" | "mid" | "low";

/**
 * Reescala el score "interno" (0-100, donde >70 ya es excelente) a una
 * escala visual más optimista. La fórmula es monótona y conserva el orden,
 * pero abre el rango alto: raw 50 → ~75, raw 70 → ~100.
 */
export function displayScore(raw: number): number {
  const r = Math.max(0, Math.min(100, Number(raw) || 0));
  const d = r * 1.3 + 10;
  return Math.round(Math.max(0, Math.min(100, d)));
}

export function scoreTier(score: number): ScoreTier {
  // Tier se calcula sobre la escala visual para que coincida con el número que ve el usuario.
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

/** Compact mini gauge badge used in list cards */
export function ScorePill({ score }: { score: number }) {
  const tier = scoreTier(score);
  const d = displayScore(score);
  return (
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
  );
}

/** Compute factor breakdown rows from a v_building_score row.
 * Prefiere `score_breakdown` unificado (base + IA cuando hay análisis).
 * Fallback a las columnas `s_*` si por alguna razón el breakdown viene vacío. */
export function buildingScoreFactors(s: any) {
  const bd: any[] = Array.isArray(s?.score_breakdown) ? s.score_breakdown : [];
  if (bd.length > 0) {
    return bd.map((c: any) => {
      const weight = Number(c.peso ?? 0);
      const pts = Number(c.contribucion ?? 0);
      const pctRaw = weight !== 0 ? (pts / Math.abs(weight)) * 100 : 0;
      const pct = Math.max(0, Math.min(100, pctRaw));
      let raw: string;
      const v = c.valor_raw;
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
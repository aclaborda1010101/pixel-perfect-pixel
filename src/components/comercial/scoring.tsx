import { cn } from "@/lib/utils";

export type ScoreTier = "high" | "mid" | "low";

export function scoreTier(score: number): ScoreTier {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
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
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
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
          {clamped.toFixed(0)}
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
  return (
    <div
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm font-semibold tabular-nums",
        tier === "high" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        tier === "mid" && "border-amber-400/40 bg-amber-400/10 text-amber-400",
        tier === "low" && "border-red-500/40 bg-red-500/10 text-red-400",
      )}
    >
      {Math.round(score)}
    </div>
  );
}

/** Compute factor breakdown rows from a v_building_score row */
export function buildingScoreFactors(s: any) {
  const ratio =
    s?.m2_total && s?.num_viviendas
      ? Number(s.m2_total) / Number(s.num_viviendas)
      : null;
  return [
    {
      label: "Nº viviendas",
      raw: s?.num_viviendas != null ? String(s.num_viviendas) : "—",
      pct: Number(s?.s_viviendas ?? 0) * 100,
      weight: 30,
    },
    {
      label: "m² totales",
      raw: s?.m2_total ? `${Number(s.m2_total).toLocaleString()} m²` : "—",
      pct: Number(s?.s_m2 ?? 0) * 100,
      weight: 20,
    },
    {
      label: "Ratio m²/vivienda",
      raw: ratio != null ? `${ratio.toFixed(1)} m²` : "—",
      pct: Number(s?.s_ratio ?? 0) * 100,
      weight: 20,
    },
    {
      label: "Nº propietarios",
      raw: s?.owners_count != null ? String(s.owners_count) : "—",
      pct: Number(s?.s_owners ?? 0) * 100,
      weight: 20,
    },
    {
      label: "Sin división horizontal",
      raw: s?.division_horizontal ? "No (con DH)" : "Sí",
      pct: Number(s?.s_no_dh ?? 0) * 100,
      weight: 10,
    },
  ].map((f) => ({ ...f, pts: (f.pct / 100) * f.weight }));
}
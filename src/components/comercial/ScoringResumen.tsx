import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ScoreGauge, scoreTier, tierBarClass, tierTextClass } from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Sparkles,
  MapPin,
} from "lucide-react";

type ClusterKey =
  | "ultra_prime"
  | "prime_value_add"
  | "flex_living_core"
  | "outer_distressed"
  | "outer_distressed_selectivo"
  | "baja_prioridad"
  | string;

const CLUSTER_LABELS: Record<string, { label: string; tagline: string; color: string }> = {
  ultra_prime: {
    label: "Ultra Prime",
    tagline: "Salida institucional · prima tamaño grande y ratios altos",
    color: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  },
  prime_value_add: {
    label: "Prime Value-Add",
    tagline: "Reforma + reventa · prima ratio m²/viv y consolidación de propietarios",
    color: "bg-violet-500/15 text-violet-300 border-violet-500/40",
  },
  flex_living_core: {
    label: "Flex Living Core",
    tagline: "Coliving / flex · prima viviendas pequeñas y ventanas para segregar",
    color: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  },
  outer_distressed: {
    label: "Outer Distressed",
    tagline: "Oportunidad por mala gestión · prima descuento y nº propietarios",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  outer_distressed_selectivo: {
    label: "Outer Distressed (selectivo)",
    tagline: "Compra puntual · selección fina por mala gestión",
    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  },
  baja_prioridad: {
    label: "Baja prioridad",
    tagline: "Fuera de tesis principal · revisar caso a caso",
    color: "bg-muted text-muted-foreground border-border-faint",
  },
};

function num(n: any): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function plural(n: number, sing: string, plur: string) {
  return n === 1 ? `1 ${sing}` : `${n} ${plur}`;
}

/** Compone la narrativa de por qué este edificio tiene este scoring. */
function buildNarrative(b: any, an: any | null, s: any): string[] {
  const parts: string[] = [];
  const md = b?.metadatos ?? {};
  const cluster: string = b?.cluster_asignado ?? "baja_prioridad";
  const clusterInfo = CLUSTER_LABELS[cluster] ?? CLUSTER_LABELS.baja_prioridad;
  const barrio = md?.barrios_completos__clonada_ ?? md?.barrio ?? null;
  const distrito = md?.distrito ?? null;

  // Frase 1: ubicación + cluster
  const ubic = barrio
    ? `en ${barrio}${distrito ? ` (${distrito})` : ""}`
    : distrito
    ? `en el distrito ${distrito}`
    : "";
  parts.push(
    `Edificio ${ubic} clasificado como **${clusterInfo.label}**. ${clusterInfo.tagline}.`
  );

  // Frase 2: tamaño y composición
  const m2 = num(s?.m2_total);
  const viv = num(s?.num_viviendas);
  const ratio = m2 && viv ? m2 / viv : null;
  const partsComp: string[] = [];
  if (m2) partsComp.push(`${m2.toLocaleString()} m²`);
  if (viv) partsComp.push(plural(viv, "vivienda", "viviendas"));
  if (ratio) partsComp.push(`ratio **${ratio.toFixed(0)} m²/viv**`);
  if (partsComp.length) parts.push(`Cuenta con ${partsComp.join(", ")}.`);

  // Frase 3: propietarios + DH
  const owners = num(s?.owners_count) ?? 0;
  const dh = b?.division_horizontal;
  const dhTxt = dh ? "con división horizontal" : "**sin división horizontal**";
  parts.push(`${plural(owners, "propietario", "propietarios")} registrado(s), ${dhTxt}.`);

  // Frase 4: análisis IA del plano (lo más jugoso visualmente)
  if (an) {
    const fortalezas: string[] = [];
    if ((an.plantas_levantables ?? 0) >= 2) {
      fortalezas.push(
        `**potencial de elevación** de ${an.plantas_levantables} planta(s) (actuales ${an.plantas_visibles ?? "?"} / máximo normativo ${an.plantas_max_normativa ?? "?"})`
      );
    } else if ((an.plantas_levantables ?? 0) === 1) {
      fortalezas.push(`opción de levantar 1 planta adicional`);
    }
    if (an.esquina) fortalezas.push(`hace **esquina** (doble fachada)`);
    if (an.segundas_escaleras) fortalezas.push(`**dos escaleras** detectadas (facilita segregación)`);
    const vent = num(an.ventanas_fachada_total);
    if (vent && vent >= 20) fortalezas.push(`**${vent} ventanas** a fachada (alta segregabilidad)`);
    else if (vent) fortalezas.push(`${vent} ventanas a fachada`);
    if (an.tiene_azotea_transitable) fortalezas.push(`azotea transitable`);
    if ((an.n_locales_planta_baja ?? 0) > 0)
      fortalezas.push(
        `${plural(an.n_locales_planta_baja, "local en planta baja", "locales en planta baja")}`
      );
    if ((an.local_pb_m2 ?? 0) >= 80)
      fortalezas.push(`local PB de ${Math.round(an.local_pb_m2)} m² convertible`);

    if (fortalezas.length) {
      parts.push(`Es **muy interesante** porque ${fortalezas.join(", ")}.`);
    }

    const debilidades: string[] = [];
    if (an.protegido_historicamente) debilidades.push("protección histórica");
    if (an.edificio_reformado) debilidades.push("edificio ya reformado");
    if (an.gestion_profesional) debilidades.push("gestión profesional (menos margen)");
    if (debilidades.length) {
      parts.push(`A tener en cuenta: ${debilidades.join(", ")}.`);
    }

    const mg = num(an.mala_gestion_score) ?? 0;
    if (mg >= 6) {
      parts.push(
        `Señales de **mala gestión / conflicto** (${mg}/10) — palanca clave para negociar entrada.`
      );
    }
  } else {
    parts.push(`_Análisis IA del plano pendiente: subir FXCC para enriquecer el scoring._`);
  }

  return parts;
}

/** Renderiza texto con **negrita** y _cursiva_ simples. */
function RichText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) {
      nodes.push(
        <strong key={i++} className="font-semibold text-foreground">
          {t.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={i++} className="text-muted-foreground">
          {t.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + t.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

type Factor = {
  key: string;
  label: string;
  weight: number;
  pts: number;
  raw: any;
};

function factorsFrom(breakdown: any): Factor[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map((c: any) => ({
    key: String(c.key ?? c.label ?? ""),
    label: String(c.label ?? c.key ?? ""),
    weight: Number(c.peso ?? 0),
    pts: Number(c.contribucion ?? 0),
    raw: c.valor_raw,
  }));
}

function formatRaw(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : "—";
  return String(v);
}

export function ScoringResumen({
  b,
  s,
  analysis,
}: {
  b: any;
  s: any;
  analysis: any | null;
}) {
  const cluster: ClusterKey = b?.cluster_asignado ?? "baja_prioridad";
  const clusterInfo = CLUSTER_LABELS[cluster] ?? CLUSTER_LABELS.baja_prioridad;
  // Usamos siempre el score de v_building_score (s.score) como fuente única,
  // que es el que se muestra en la lista de edificios. Esto evita que el
  // cluster recompute (que puede bajar a "baja_prioridad" barrios no mapeados)
  // contradiga al usuario lo que ve en la card.
  const score = Number(s?.score ?? b?.score ?? b?.cluster_score ?? 0);
  const tier = scoreTier(score);
  const breakdown =
    (Array.isArray(s?.score_breakdown) && s.score_breakdown.length > 0
      ? s.score_breakdown
      : Array.isArray(b?.cluster_breakdown) && b.cluster_breakdown.length > 0
      ? b.cluster_breakdown
      : []) as any[];
  const factors = factorsFrom(breakdown);

  // Separar positivos (pts>0) y penalizaciones (pts<0 o weight<0)
  const positivos = factors
    .filter((f) => f.pts > 0 && f.weight > 0)
    .sort((a, b) => b.pts - a.pts);
  const penalizaciones = factors.filter((f) => f.pts < 0 || f.weight < 0);

  const narrative = buildNarrative(b, analysis, s);

  const avisos: any[] = Array.isArray(b?.avisos_inteligentes) ? b.avisos_inteligentes : [];
  const highAvisos = avisos.filter((a) => a?.severity === "high" || a?.severity === "medium");

  return (
    <Card className="overflow-hidden border-border-faint">
      <CardContent className="space-y-6 p-0">
        {/* Cabecera: cluster + score */}
        <div className="flex flex-col gap-4 border-b border-border-faint bg-surface-1/40 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <ScoreGauge score={score} size={120} thickness={10} label="Score" />
            <div className="space-y-1.5">
              <Eyebrow>
                <Sparkles className="mr-1 inline h-3 w-3" /> Resumen del scoring
              </Eyebrow>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("border font-mono uppercase tracking-eyebrow", clusterInfo.color)}>
                  <MapPin className="mr-1 h-3 w-3" /> {clusterInfo.label}
                </Badge>
                <span
                  className={cn(
                    "font-mono text-[11px] uppercase tracking-eyebrow",
                    tierTextClass[tier],
                  )}
                >
                  Potencial {tier === "high" ? "alto" : tier === "mid" ? "medio" : "bajo"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{clusterInfo.tagline}.</p>
            </div>
          </div>

          {highAvisos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 md:max-w-sm md:justify-end">
              {highAvisos.map((a, i) => (
                <Badge
                  key={i}
                  variant={a.severity === "high" ? "gold" : "outline"}
                  className="font-mono text-[10px] uppercase tracking-eyebrow"
                >
                  {a.label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Narrativa */}
        <div className="space-y-3 px-6">
          {narrative.map((p, i) => (
            <p key={i} className="text-sm leading-relaxed text-muted-foreground">
              <RichText text={p} />
            </p>
          ))}
        </div>

        {/* Por qué este score: factores ordenados */}
        <div className="grid grid-cols-1 gap-6 px-6 pb-6 md:grid-cols-2">
          <div className="space-y-3">
            <Eyebrow>
              <TrendingUp className="mr-1 inline h-3 w-3 text-emerald-400" /> Aporta al score
            </Eyebrow>
            <div className="space-y-2.5">
              {positivos.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  Sin factores positivos relevantes.
                </div>
              )}
              {positivos.map((f) => {
                const pctOfWeight = f.weight > 0 ? Math.min(100, (f.pts / f.weight) * 100) : 0;
                const t = scoreTier(pctOfWeight);
                return (
                  <div key={f.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-foreground">{f.label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatRaw(f.raw)} ·{" "}
                        <span className={tierTextClass[t]}>+{f.pts.toFixed(1)}</span>
                        <span className="ml-0.5 text-[10px] opacity-50">/{f.weight}</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
                      <div
                        className={cn("h-full transition-all duration-500", tierBarClass[t])}
                        style={{ width: `${Math.max(3, pctOfWeight)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <Eyebrow>
              <TrendingDown className="mr-1 inline h-3 w-3 text-red-400" /> Penalizaciones
            </Eyebrow>
            <div className="space-y-2.5">
              {penalizaciones.length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin penalizaciones aplicadas.</div>
              ) : (
                penalizaciones.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2.5"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-red-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-foreground">{f.label}</div>
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-red-400">
                        {f.pts.toFixed(1)} pts
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {b?.cluster_motivo && (
          <div className="border-t border-border-faint bg-surface-1/40 px-6 py-3">
            <Eyebrow>Motivo del cluster</Eyebrow>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">
              {b.cluster_motivo}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
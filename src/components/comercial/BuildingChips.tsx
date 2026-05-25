import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Aviso = {
  key: string;
  label: string;
  icon?: string;
  color: "oportunidad" | "alerta" | "neutro";
  reasoning: string;
  confidence: number | null;
  sources: string[];
};

const COLOR_CLASS: Record<Aviso["color"], string> = {
  oportunidad: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  alerta: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  neutro: "border-border-faint bg-surface-1/60 text-muted-foreground",
};

function sourceLabel(s: string): string {
  if (s.startsWith("street_view")) return "📷 Street View";
  if (s.startsWith("catastro_pdf")) return "📐 Plano Catastro";
  if (s === "satellite") return "🛰️ Satélite";
  if (s === "oblique") return "🖼️ Oblicua";
  if (s === "dnprc_json") return "📄 DNPRC";
  if (s === "calculated_from_ancho_calle") return "🧮 Calculado";
  if (s === "inferred_symmetry") return "🔁 Simetría";
  return s;
}

export function BuildingChips({
  avisos,
  hasAnalysis,
  max = 4,
  size = "sm",
}: {
  avisos: Aviso[] | null | undefined;
  hasAnalysis: boolean;
  max?: number;
  size?: "sm" | "md";
}) {
  const list = Array.isArray(avisos) ? avisos.filter((a) => a && a.reasoning) : [];

  if (!hasAnalysis && list.length === 0) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                "cursor-help border-dashed",
                COLOR_CLASS.neutro,
                size === "sm" ? "h-5 px-1.5 text-[10px]" : "px-2 text-xs",
              )}
            >
              ⏳ Análisis IA pendiente
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">
              Pulsa <strong>Descargar Catastro + Planos + IA</strong> dentro de la ficha o espera al batch automático.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (list.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap gap-1">
        {list.slice(0, max).map((a) => (
          <Tooltip key={a.key}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "cursor-help font-medium",
                  COLOR_CLASS[a.color],
                  size === "sm" ? "h-5 px-1.5 text-[10px]" : "px-2 py-0.5 text-xs",
                )}
              >
                {a.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <div className="space-y-1.5">
                <p className="text-xs leading-relaxed">{a.reasoning}</p>
                {a.sources?.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {a.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border-faint bg-surface-1/40 px-1 py-0.5 font-mono text-[9px] text-muted-foreground"
                      >
                        {sourceLabel(s)}
                      </span>
                    ))}
                  </div>
                )}
                {typeof a.confidence === "number" && (
                  <div className="space-y-0.5 pt-1">
                    <div className="flex justify-between font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                      <span>Confianza</span>
                      <span>{Math.round(a.confidence * 100)}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                      <div
                        className={cn(
                          "h-full",
                          a.confidence >= 0.8 ? "bg-emerald-500/80" : a.confidence >= 0.6 ? "bg-amber-500/80" : "bg-red-500/80",
                        )}
                        style={{ width: `${Math.round(a.confidence * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
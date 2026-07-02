import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type AlarmaAviso = {
  key: string;
  tipo?: string;
  label: string;
  detail?: string;
  severity?: "low" | "medium" | "high";
};

export function extractAlarmas(avisos: any): AlarmaAviso[] {
  if (!Array.isArray(avisos)) return [];
  return avisos.filter((a: any) => a && a.tipo === "alarma" && a.key !== "estrella") as AlarmaAviso[];
}

export function StarBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className={cn(
              "cursor-help border-0 bg-gradient-to-r from-yellow-400 to-amber-500 font-semibold text-black shadow",
              size === "sm" ? "h-5 px-1.5 text-[10px]" : "px-2 py-0.5 text-xs",
            )}
          >
            ⭐ ESTRELLA
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="text-xs">Terciario ≥ 66 % + 2 escaleras. Máxima prioridad.</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AlarmChips({
  avisos,
  esEstrella,
  size = "sm",
  max = 4,
}: {
  avisos: any;
  esEstrella?: boolean | null;
  size?: "sm" | "md";
  max?: number;
}) {
  const alarmas = extractAlarmas(avisos);
  if (!esEstrella && alarmas.length === 0) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap gap-1">
        {esEstrella && <StarBadge size={size} />}
        {alarmas.slice(0, max).map((a) => (
          <Tooltip key={a.key}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  "cursor-help border-red-500/40 bg-red-500/10 font-medium text-red-300",
                  size === "sm" ? "h-5 px-1.5 text-[10px]" : "px-2 py-0.5 text-xs",
                )}
              >
                {a.label}
              </Badge>
            </TooltipTrigger>
            {a.detail && (
              <TooltipContent className="max-w-sm">
                <p className="text-xs leading-relaxed">{a.detail}</p>
              </TooltipContent>
            )}
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

export function countAlarmas(avisos: any): number {
  return extractAlarmas(avisos).length;
}
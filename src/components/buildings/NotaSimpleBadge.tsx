import { FileText, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Building = {
  metadatos?: Record<string, any> | null;
};

/**
 * Indicador explícito de si un edificio tiene nota simple asociada.
 * - Verde + documento: hay nota simple (metadatos de HubSpot o registro en notas_simples).
 * - Ámbar + alerta: no consta nota simple.
 * Usar en tarjetas de edificio y ficha de detalle.
 */
export function NotaSimpleBadge({
  building,
  hasNota,
  className,
}: {
  building?: Building;
  hasNota?: boolean;
  className?: string;
}) {
  const meta = building?.metadatos ?? {};
  const metaFlag = String(meta.tenemos_la_nota_simple_ ?? "").trim().toLowerCase();
  const tieneNota = hasNota ?? (metaFlag === "sí" || metaFlag === "si");

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 normal-case",
              tieneNota
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/50 bg-amber-500/10 text-amber-400",
              className,
            )}
          >
            {tieneNota ? (
              <>
                <FileText className="h-3 w-3" /> Con nota simple
              </>
            ) : (
              <>
                <AlertTriangle className="h-3 w-3" /> Sin nota simple
              </>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          {tieneNota
            ? "Existe nota simple asociada a este edificio."
            : "No consta nota simple para este edificio. Revisar documentación."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Building = {
  score?: number | null;
  metadatos?: Record<string, any> | null;
  catastro_ref?: string | null;
  refcatastral?: string | null;
  iee_estado?: string | null;
};

/**
 * Aviso visual de documentación faltante para un edificio.
 * USAR SOLO en vistas de CARTERA (lista comercial / ficha de detalle).
 * No usar en listados globales: hay miles de edificios sin score.
 */
export function DocAlertBadge({ building, className }: { building: Building; className?: string }) {
  if (!building) return null;
  const meta = building.metadatos ?? {};
  const refCat = String(
    meta.referencia_catastral ?? meta.refcatastral ?? building.catastro_ref ?? building.refcatastral ?? "",
  ).trim();
  const sinCatastro = !refCat || building.score == null || Number(building.score) === 0;
  const sinNota = String(meta.tenemos_la_nota_simple_ ?? "").trim().toLowerCase() === "no";
  const ieeAlerta = ["desfavorable_grave", "caducada", "pendiente"].includes(String(building.iee_estado ?? ""));

  if (!sinCatastro && !sinNota && !ieeAlerta) return null;

  const reasons: string[] = [];
  if (sinCatastro) reasons.push("Sin datos de Catastro — no se puede puntuar");
  if (sinNota) reasons.push("Falta nota simple");
  if (ieeAlerta) reasons.push(
    building.iee_estado === "caducada" ? "IEE caducada"
    : building.iee_estado === "pendiente" ? "IEE nunca presentada"
    : "IEE desfavorable grave",
  );
  const tooltip = reasons.join(" · ");
  const both = (sinCatastro && sinNota) || ieeAlerta;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "gap-1 normal-case",
              both
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-amber-500/50 bg-amber-500/10 text-amber-400",
              className,
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {ieeAlerta
              ? (building.iee_estado === "caducada" ? "IEE caducada"
                : building.iee_estado === "pendiente" ? "IEE pendiente"
                : "IEE desfavorable")
              : sinCatastro && sinNota ? "Sin catastro · sin nota"
              : sinCatastro ? "Sin catastro" : "Sin nota simple"}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ShieldAlert, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = { buildingId: string };

export function PgoumBlock({ buildingId }: Props) {
  const [ba, setBa] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [{ data: a }, { data: q }] = await Promise.all([
        supabase
          .from("building_analysis")
          .select(
            "protegido_historicamente, proteccion_source, plantas_visibles, plantas_max_normativa, plantas_levantables, plantas_levantables_requiere_humano",
          )
          .eq("building_id", buildingId)
          .maybeSingle(),
        supabase
          .from("proteccion_validation_queue")
          .select("estado, capa, nivel_proteccion, n_catalogo, validado_resultado, validado_at, nota")
          .eq("building_id", buildingId)
          .maybeSingle(),
      ]);
      setBa(a);
      setQueue(q);
    })();
  }, [buildingId]);

  const protegido = ba?.protegido_historicamente === true;
  const fuenteLabel =
    ba?.proteccion_source === "pgou_poligono"
      ? "PGOUM (polígono)"
      : ba?.proteccion_source === "pgou_rc14"
        ? "PGOUM (RC14)"
        : ba?.proteccion_source === "pgou_ape_distrito"
          ? "PGOUM (APE/PEPS)"
          : ba?.proteccion_source === "pgou_legacy_poligono" || ba?.proteccion_source === "pgou_legacy_rc14"
            ? "PGOUM (legacy)"
            : ba?.proteccion_source ?? "—";

  const validacion =
    queue?.validado_at
      ? queue?.validado_resultado === true
        ? { label: "Confirmado por equipo", variant: "success" as const }
        : queue?.validado_resultado === false
          ? { label: "Corregido por equipo", variant: "warning" as const }
          : { label: "Validado", variant: "info" as const }
      : queue?.estado === "hit_pgou"
        ? { label: "Pendiente validación", variant: "warning" as const }
        : queue?.estado === "marcado_pero_miss"
          ? { label: "Marcado sin fuente PGOUM", variant: "destructive" as const }
          : queue?.estado === "needs_review_sin_fuente"
            ? { label: "Requiere revisión", variant: "outline" as const }
            : { label: "Sin cola", variant: "outline" as const };

  return (
    <Card>
      <CardHeader>
        <Eyebrow>
          <ShieldAlert className="mr-1 inline h-3 w-3" /> PGOUM Madrid
        </Eyebrow>
        <CardTitle>Protección urbanística y edificabilidad</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">Protegido</div>
            <div className="mt-1">
              <Badge variant={protegido ? "destructive" : "outline"}>{protegido ? "Sí" : "No"}</Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Nivel</div>
            <div className="mt-1 font-medium">{queue?.nivel_proteccion ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Fuente</div>
            <div className="mt-1">{fuenteLabel}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Validación humana</div>
            <div className="mt-1">
              <Badge variant={validacion.variant as any}>{validacion.label}</Badge>
            </div>
          </div>
          {queue?.n_catalogo && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground">Nº catálogo / APE</div>
              <div className="mt-1 font-mono text-xs">{queue.n_catalogo}</div>
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Layers className="h-3 w-3" /> Plantas levantables (PGOUM − Catastro)
          </div>
          {ba?.plantas_levantables_requiere_humano ? (
            <div className="rounded-md bg-muted/40 p-2 text-xs">
              <Badge variant="warning">Requiere criterio humano</Badge>
              <span className="ml-2">
                Sin altura máxima normativa fiable. Actuales:{" "}
                <strong>{ba?.plantas_visibles ?? "?"}</strong> plantas
                {protegido ? "; edificio protegido (PGOUM)." : "."}
              </span>
            </div>
          ) : (
            <div className="text-sm">
              <strong>{ba?.plantas_levantables ?? 0}</strong> plantas levantables
              <span className="ml-2 text-xs text-muted-foreground">
                ({ba?.plantas_visibles ?? "?"} actuales / max normativa {ba?.plantas_max_normativa ?? "?"})
              </span>
              {protegido && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  ⚠ Edificio protegido: cambio de uso a hospedaje y levantes pueden estar restringidos.
                </div>
              )}
            </div>
          )}
        </div>

        {queue?.nota && (
          <p className="text-[11px] italic text-muted-foreground">Nota: {queue.nota}</p>
        )}
      </CardContent>
    </Card>
  );
}
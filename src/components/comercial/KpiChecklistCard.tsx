import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, CircleDashed, XCircle, Target, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type Estado = "tenemos" | "a_medias" | "falta";
type Kpi = { clave: string; label: string; estado: Estado; evidencia: string | null };
type Resp = { total: number; completados: number; kpis: Kpi[]; a_abordar: string[] };

export function KpiChecklistCard({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const { data: res, error: err } = await supabase.functions.invoke("agent_kpi_checklist", {
        body: { owner_id: ownerId },
      });
      if (cancelled) return;
      if (err) setError(err.message);
      else setData(res as Resp);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  const aAbordar = (data?.a_abordar ?? []).map((c) => data?.kpis.find((k) => k.clave === c)).filter(Boolean) as Kpi[];

  const iconFor = (k: Kpi) => {
    if (k.estado === "tenemos") {
      return <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />;
    }
    if (k.estado === "a_medias") {
      return <CircleDashed className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />;
    }
    return <Circle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />;
  };

  return (
    <Card>
      <CardHeader>
        <Eyebrow>KPIs · qué tenemos / qué falta</Eyebrow>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Cobertura de información</span>
          {data && (
            <span className="font-mono text-sm text-gold">
              {data.completados} de {data.total} completados
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {loading && <div className="text-muted-foreground">Analizando notas de llamadas y HubSpot…</div>}
        {error && <div className="text-destructive">Error: {error}</div>}
        {!loading && data && (
          <>
            {aAbordar.length > 0 && (
              <div className="rounded-[6px] border border-gold/40 bg-gold-soft/30 p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-eyebrow text-gold">
                  <Target className="h-3.5 w-3.5" /> A abordar en esta llamada
                </div>
                <ul className="mt-2 space-y-1.5">
                  {aAbordar.map((k) => (
                    <li key={k.clave} className="flex items-start gap-2">
                      {k.clave === "cuadro_rentas" ? (
                        <Star className="mt-0.5 h-4 w-4 flex-shrink-0 fill-gold text-gold" />
                      ) : (
                        <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gold" />
                      )}
                      <span className={cn("text-foreground", k.clave === "cuadro_rentas" && "font-medium")}>
                        {k.label}
                        {k.clave === "cuadro_rentas" && (
                          <Badge variant="gold" className="ml-2 text-[10px]">prioridad</Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="space-y-2">
              {data.kpis.map((k) => (
                <li key={k.clave} className="flex items-start gap-2">
                  {iconFor(k)}
                  <div className="min-w-0">
                    <div className={cn("text-foreground", k.clave === "cuadro_rentas" && "font-medium")}>
                      {k.label}
                      {k.clave === "cuadro_rentas" && (
                        <Star className="ml-1.5 inline-block h-3.5 w-3.5 align-text-bottom fill-gold text-gold" />
                      )}
                    </div>
                    {k.estado === "tenemos" && k.evidencia && (
                      <div className="mt-0.5 text-xs italic text-muted-foreground">
                        "{k.evidencia}"
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
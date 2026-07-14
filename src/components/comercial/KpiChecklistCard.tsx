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

  const tenemos = (data?.kpis ?? []).filter((k) => k.estado === "tenemos");
  const aMedias = (data?.kpis ?? []).filter((k) => k.estado === "a_medias");
  const faltan = (data?.kpis ?? []).filter((k) => k.estado === "falta");
  const aAbordar = (data?.a_abordar ?? []).map((c) => data?.kpis.find((k) => k.clave === c)).filter(Boolean) as Kpi[];

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

            <Group
              title="Tenemos"
              icon={<CheckCircle2 className="h-4 w-4 text-success" />}
              tone="success"
              items={tenemos}
              showEvidence
            />
            <Group
              title="A medias"
              icon={<CircleDashed className="h-4 w-4 text-warn" />}
              tone="warn"
              items={aMedias}
            />
            <Group
              title="Faltan"
              icon={<XCircle className="h-4 w-4 text-muted-foreground" />}
              tone="muted"
              items={faltan}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Group({
  title, icon, tone, items, showEvidence,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "success" | "warn" | "muted";
  items: Kpi[];
  showEvidence?: boolean;
}) {
  if (items.length === 0) return null;
  const toneCls =
    tone === "success" ? "border-success/30 bg-success-soft/20"
    : tone === "warn" ? "border-amber-500/30 bg-amber-500/10"
    : "border-border-faint bg-surface-1/30";
  return (
    <div className={cn("rounded-[6px] border p-3", toneCls)}>
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-eyebrow text-muted-foreground">
        {icon} {title} <span className="font-mono">({items.length})</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((k) => (
          <li key={k.clave}>
            <div className="text-foreground">{k.label}</div>
            {showEvidence && k.evidencia && (
              <blockquote className="mt-1 border-l-2 border-success/40 pl-2 text-xs italic text-muted-foreground">
                "{k.evidencia}"
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
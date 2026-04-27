import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, GitMerge, ArrowLeftRight, AlertTriangle } from "lucide-react";
import { BetaBanner } from "@/components/common/BetaBanner";

export default function Matching() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [recalc, setRecalc] = useState(false);
  const load = () => {
    supabase
      .from("match_candidates")
      .select("*, assets(tipo,ubicacion,ciudad), investors(nombre,consentimiento)")
      .order("score", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  };
  useEffect(load, []);

  const setEstado = async (
    row: any,
    estado: "aprobado" | "rechazado" | "contactado" | "propuesto",
  ) => {
    if (estado === "aprobado" && row.investors && row.investors.consentimiento === false) {
      await supabase.from("compliance_cases").insert({
        scope_type: "match",
        scope_id: row.id,
        motivo: `Aprobación bloqueada: inversor "${row.investors.nombre}" sin consentimiento`,
        evidencia: row.evidencia ?? null,
        dpia_ok: false,
      });
      toast.error("Bloqueado por compliance — caso creado");
      return;
    }
    const { error } = await supabase.from("match_candidates").update({ estado }).eq("id", row.id);
    if (error) toast.error(error.message);
    else { toast.success("Actualizado"); load(); }
  };

  const recompute = async () => {
    setRecalc(true);
    try {
      const { data, error } = await supabase.functions.invoke("compute_matches", { body: { threshold: 0.6 } });
      if (error) throw error;
      const r = data as any;
      toast.success(`Evaluados ${r.evaluated} · nuevos ${r.inserted}`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally { setRecalc(false); }
  };

  const propuestos = rows.filter((r) => r.estado === "propuesto").length;
  const aprobados = rows.filter((r) => r.estado === "aprobado").length;
  const avgScore = rows.length ? rows.reduce((a, r) => a + Number(r.score || 0), 0) / rows.length : 0;

  const scoreClass = (s: number) =>
    s >= 0.8 ? "text-success" : s >= 0.6 ? "text-gold" : "text-muted-foreground";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operaciones · Matching"
        title={t.nav.matching}
        subtitle="Cola de candidatos asset ↔ inversor"
        actions={
          <Button size="sm" variant="gold" onClick={recompute} disabled={recalc}>
            {recalc ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Recalcular
          </Button>
        }
      />
      <BetaBanner />

      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Propuestos</Eyebrow><div className="mt-2"><MetricValue size="lg">{propuestos}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Aprobados</Eyebrow><div className="mt-2"><MetricValue size="lg">{aprobados}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Score medio</Eyebrow><div className="mt-2"><MetricValue size="lg">{avgScore.toFixed(2)}</MetricValue></div></div></Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={GitMerge}
          title="Sin candidatos en cola"
          description="Pulsa “Recalcular” para evaluar matches entre inversores y activos."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((r) => {
            const score = Number(r.score || 0);
            const noConsent = r.investors?.consentimiento === false;
            return (
              <Card key={r.id} className="overflow-hidden">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="space-y-1">
                    <Eyebrow>Candidato · {r.estado}</Eyebrow>
                    <CardTitle className="flex items-center gap-2 font-editorial text-base tracking-notarial">
                      <span>{r.investors?.nombre ?? "?"}</span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-gold" />
                      <span className="text-foreground">{r.assets?.tipo} {r.assets?.ubicacion}</span>
                    </CardTitle>
                  </div>
                  <div className="text-right">
                    <Eyebrow>Score</Eyebrow>
                    <div className={`mt-1 font-mono text-2xl tabular-nums ${scoreClass(score)}`}>
                      {score.toFixed(2)}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
                      <Eyebrow>Inversor</Eyebrow>
                      <div className="mt-1 text-sm text-foreground">{r.investors?.nombre ?? "—"}</div>
                      {noConsent && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Sin consentimiento
                        </div>
                      )}
                    </div>
                    <div className="rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
                      <Eyebrow>Activo</Eyebrow>
                      <div className="mt-1 text-sm text-foreground">{r.assets?.tipo} · {r.assets?.ubicacion}</div>
                      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{r.assets?.ciudad ?? "—"}</div>
                    </div>
                  </div>
                  {r.evidencia && (
                    <div className="rounded-[6px] border border-border-faint bg-background p-3 text-xs text-muted-foreground">
                      <Eyebrow className="mb-1">Evidencia</Eyebrow>
                      {r.evidencia}
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-border-faint pt-3">
                    <Badge variant={r.estado === "aprobado" ? "success" : r.estado === "rechazado" ? "danger" : "outline"}>
                      {r.estado}
                    </Badge>
                    {r.estado === "propuesto" && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setEstado(r, "rechazado")}>Rechazar</Button>
                        <Button size="sm" variant="gold" onClick={() => setEstado(r, "aprobado")}>Aprobar</Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

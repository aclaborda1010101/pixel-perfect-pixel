import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { useBuildingProcessing, useBuildingAnalysis } from "@/lib/analisisIA";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain, Camera, MapPin, Loader2, RefreshCw, Download } from "lucide-react";

export function AnalisisIASection({ buildingId }: { buildingId: string }) {
  const { data: status } = useBuildingProcessing(buildingId);
  const { data: analysis } = useBuildingAnalysis(buildingId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const hasData = !!analysis?.analysis;
  const running = status?.status === "running";

  const trigger = async (force = false) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("process-building-full", {
        body: { building_id: buildingId, force },
      });
      if (error) throw error;
      toast.success(`Procesado: ${(data as any)?.status ?? "ok"}`);
      qc.invalidateQueries({ queryKey: ["building_analysis", buildingId] });
      qc.invalidateQueries({ queryKey: ["building_processing_status", buildingId] });
      qc.invalidateQueries({ queryKey: ["comercial:edificio", buildingId] });
    } catch (e: any) {
      toast.error("Error: " + (e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const phases = [
    { key: "catastro", label: "Catastro", icon: MapPin },
    { key: "google", label: "Imágenes", icon: Camera },
    { key: "vision", label: "Análisis IA", icon: Brain },
  ];

  const a = analysis?.analysis;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <Eyebrow><Brain className="mr-1 inline h-3 w-3" /> Análisis IA · Catastro · Google · Gemini</Eyebrow>
          <CardTitle>Enriquecimiento del edificio</CardTitle>
          {!hasData && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-gold">
              Análisis IA pendiente — pulsa Descargar para enriquecer
            </div>
          )}
        </div>
        <Button onClick={() => trigger(hasData)} disabled={busy || running} variant="gold" size="sm">
          {busy || running ? <Loader2 className="h-3 w-3 animate-spin" /> : hasData ? <RefreshCw className="h-3 w-3" /> : <Download className="h-3 w-3" />}
          {hasData ? "Re-procesar Catastro + Planos" : "Descargar Catastro + Planos + IA"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {phases.map((p) => {
            const active = status?.current_phase === p.key;
            const ok = (p.key === "catastro" && !!analysis?.catastro)
              || (p.key === "google" && (analysis?.imgs?.length ?? 0) > 0)
              || (p.key === "vision" && hasData);
            return (
              <div key={p.key} className="flex items-center gap-2 text-xs">
                <div className={`rounded-md border p-2 ${active && running ? "border-gold text-gold" : ok ? "border-emerald-600 text-emerald-500" : "border-border-faint text-muted-foreground"}`}>
                  {active && running ? <Loader2 className="h-3 w-3 animate-spin" /> : <p.icon className="h-3 w-3" />}
                </div>
                <span className="font-mono uppercase tracking-eyebrow">{p.label}</span>
              </div>
            );
          })}
          {status?.error && (
            <Badge variant="destructive" className="ml-auto">{status.error}</Badge>
          )}
        </div>

        {hasData ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Ventanas fachada" value={a?.ventanas_fachada_total ?? "—"} />
            <Stat label="Patios" value={a?.patios_detectados ?? "—"} />
            <Stat label="Esquina" value={a?.esquina ? "Sí" : "No"} />
            <Stat label="2ª escalera" value={a?.segundas_escaleras ? "Sí" : "No"} />
            <Stat label="Plantas visibles" value={a?.plantas_visibles ?? "—"} />
            <Stat label="Plantas máx norm." value={a?.plantas_max_normativa ?? "—"} />
            <Stat label="Levantables" value={a?.plantas_levantables ?? "—"} accent={a?.plantas_levantables > 0} />
            <Stat label="Protegido" value={a?.protegido_historicamente ? "Sí" : "No"} />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Sin análisis IA todavía. Pulsa el botón para procesar Catastro + planos + análisis.
          </div>
        )}

        {(analysis?.imgs?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
            {analysis!.imgs!.map((img: any) => (
              <a key={img.id} href={img.public_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border-faint">
                <img src={img.public_url} alt={img.source} className="aspect-square w-full object-cover" loading="lazy" />
                <div className="bg-surface-1 px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                  {img.source}{img.heading != null ? ` · ${img.heading}°` : ""}
                </div>
              </a>
            ))}
          </div>
        )}

        {a?.modelo_usado && (
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            modelo: {a.modelo_usado}{a.modelo_fallback ? " (fallback)" : ""} · confianza: {a.confidence ?? "—"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg tabular-nums ${accent ? "text-gold" : "text-foreground"}`}>{String(value)}</div>
    </div>
  );
}
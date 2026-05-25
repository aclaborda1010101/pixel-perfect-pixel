import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Sparkles, Eye, ScanSearch } from "lucide-react";
import { useBuildingAnalysis } from "@/lib/analisisIA";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TIPO_COLOR: Record<string, string> = {
  patio: "border-cyan-400 bg-cyan-400/15 text-cyan-300",
  escalera: "border-purple-400 bg-purple-400/15 text-purple-300",
  fachada: "border-gold bg-gold/15 text-gold",
};
function colorFor(tipo: string | undefined, etiqueta: string | undefined) {
  const k = (tipo || etiqueta || "").toLowerCase();
  if (k.includes("patio")) return TIPO_COLOR.patio;
  if (k.includes("escalera")) return TIPO_COLOR.escalera;
  if (k.includes("fachada")) return TIPO_COLOR.fachada;
  return "border-emerald-400 bg-emerald-400/15 text-emerald-300";
}

export function AnalisisPlanoCatastralCard({ buildingId }: { buildingId: string }) {
  const { data } = useBuildingAnalysis(buildingId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<null | "re" | "premium">(null);
  const [modalOpen, setModalOpen] = useState(false);

  const a = data?.analysis;
  const plano = data?.catastro?.plano_url;
  const anotaciones: any[] = Array.isArray(a?.anotaciones_plano) ? a.anotaciones_plano : [];

  if (!a) {
    return (
      <Card>
        <CardHeader>
          <Eyebrow><ScanSearch className="mr-1 inline h-3 w-3" /> Análisis del plano catastral</Eyebrow>
          <CardTitle>🔍 Análisis del plano catastral</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Sin análisis aún. Pulsa "Descargar Catastro + Planos + IA" arriba para procesar el edificio.
          </div>
        </CardContent>
      </Card>
    );
  }

  const reanalizar = async (modelOverride?: string) => {
    setBusy(modelOverride ? "premium" : "re");
    try {
      const { error } = await supabase.functions.invoke("analyze-building-vision", {
        body: { building_id: buildingId, model_override: modelOverride },
      });
      if (error) throw error;
      toast.success(modelOverride ? "Re-analizado con modelo premium" : "Re-analizado");
      qc.invalidateQueries({ queryKey: ["building_analysis", buildingId] });
      qc.invalidateQueries({ queryKey: ["comercial:edificio", buildingId] });
    } catch (e: any) {
      toast.error("Error: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  };

  const dur = a.analysis_duration_ms ? `${(a.analysis_duration_ms / 1000).toFixed(1)}s` : "—";
  const conf = a.confidence != null ? `${Math.round(Number(a.confidence) * 100)}%` : "—";
  const ancho = data?.catastro?.ancho_calle_m;

  const fachadaAnots = anotaciones.filter((x) => /fachada/i.test(x.tipo || x.etiqueta || ""));
  const fachadaPrincipal = fachadaAnots[0];
  const fachadaSecundaria = fachadaAnots[1];

  const explicacion = [
    `Analicé el plano catastral`,
    plano ? "" : "(plano no disponible)",
    `. Detecté: ${a.patios_detectados ?? 0} patios interiores`,
    `, parcela ${a.esquina ? "en esquina" : "no esquina"}`,
    ancho ? `, ancho de calle ${ancho} m` : "",
    fachadaPrincipal?.descripcion ? `, ${fachadaPrincipal.descripcion}` : "",
    a.esquina && fachadaSecundaria?.descripcion ? `, ${fachadaSecundaria.descripcion}` : "",
    `, ${a.segundas_escaleras ? "2+ cajas de escaleras visibles" : "1 caja de escaleras"}`,
    `. Confianza ${conf}. Modelo: ${a.modelo_usado}${a.modelo_fallback ? " (fallback)" : ""}. Tiempo: ${dur}.`,
  ].join("");

  return (
    <>
      <Card>
        <CardHeader>
          <Eyebrow><ScanSearch className="mr-1 inline h-3 w-3" /> Análisis del plano catastral</Eyebrow>
          <CardTitle>🔍 Análisis del plano catastral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground">{explicacion}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setModalOpen(true)} disabled={!plano}>
              <Eye className="h-3 w-3" /> Ver plano procesado con anotaciones
            </Button>
            <Button size="sm" variant="outline" onClick={() => reanalizar()} disabled={busy !== null}>
              {busy === "re" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Re-analizar plano
            </Button>
            <Button size="sm" variant="gold" onClick={() => reanalizar("google/gemini-2.5-pro")} disabled={busy !== null}>
              {busy === "premium" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Re-analizar con Gemini 2.5 Pro (más preciso)
            </Button>
            {anotaciones.length > 0 && (
              <Badge variant="outline">{anotaciones.length} anotaciones IA</Badge>
            )}
          </div>

          <div className="rounded-md border border-border-faint bg-surface-1/40 p-3 text-xs text-muted-foreground">
            Las variables críticas <span className="font-medium text-foreground">Ventanas</span>,{" "}
            <span className="font-medium text-foreground">Altura real</span> y{" "}
            <span className="font-medium text-foreground">Protección histórica</span>{" "}
            NO se extraen del plano sino de Street View y Satélite — el plano solo aporta{" "}
            <span className="font-medium text-foreground">forma, patios, fachada y escaleras</span>.
          </div>
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Plano catastral · anotaciones IA</DialogTitle>
          </DialogHeader>
          <PlanoAnotado planoUrl={plano} anotaciones={anotaciones} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanoAnotado({ planoUrl, anotaciones }: { planoUrl: string | null | undefined; anotaciones: any[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current!.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  if (!planoUrl) {
    return <div className="p-6 text-sm text-muted-foreground">Plano no disponible.</div>;
  }

  return (
    <div className="space-y-3">
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-md border border-border-faint bg-white">
        <img src={planoUrl} alt="Plano catastral" className="block h-auto w-full" />
        {size.w > 0 && anotaciones.map((an, i) => {
          const bbox = Array.isArray(an.bbox) ? an.bbox : null;
          if (!bbox || bbox.length < 4) return null;
          const [x, y, w, h] = bbox.map(Number);
          if ([x, y, w, h].some((v) => !isFinite(v))) return null;
          const cls = colorFor(an.tipo, an.etiqueta);
          return (
            <div
              key={i}
              className={`absolute border-2 ${cls.replace(/text-\S+/, "")} flex items-start`}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              }}
              title={an.descripcion ?? an.etiqueta}
            >
              <span className={`m-0.5 rounded-sm border px-1 font-mono text-[9px] uppercase tracking-eyebrow ${cls}`}>
                {an.etiqueta ?? an.tipo ?? `#${i + 1}`}
              </span>
            </div>
          );
        })}
      </div>
      {anotaciones.length === 0 && (
        <div className="rounded-md border border-dashed border-border-faint p-3 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          La IA no devolvió anotaciones en este análisis. Re-analiza con el modelo premium para forzar el etiquetado.
        </div>
      )}
      {anotaciones.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {anotaciones.map((an, i) => (
            <li key={i} className={`rounded-md border px-2 py-1 ${colorFor(an.tipo, an.etiqueta)}`}>
              <span className="font-mono text-[10px] uppercase tracking-eyebrow">{an.etiqueta ?? an.tipo}</span>
              {an.descripcion ? <span className="ml-2 text-foreground">{an.descripcion}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
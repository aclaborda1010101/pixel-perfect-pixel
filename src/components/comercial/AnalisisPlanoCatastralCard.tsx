import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Eye, ScanSearch, FileText, ThumbsUp, ThumbsDown } from "lucide-react";
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
  const [busy, setBusy] = useState<null | "re">(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pageZoom, setPageZoom] = useState<{ url: string; label: string } | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<null | "ok" | "ajuste">(null);

  const enviarFeedback = async (valor: "ok" | "ajuste") => {
    setFeedbackBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("scoring_v2_feedback").insert({
        building_id: buildingId,
        user_id: u?.user?.id ?? null,
        tipo: "ventanas_patio",
        valor,
        aviso_key: "ventanas_patio",
        vote: valor === "ok" ? 1 : -1,
        user_email: u?.user?.email ?? null,
        payload: {
          patios_detectados: a?.patios_detectados,
          ventanas_patios_estimadas: a?.ventanas_patios_estimadas,
          formula: a?.formula_ventanas_patio,
          densidad_ventanas_fachada: a?.densidad_ventanas_fachada,
        },
      });
      if (error) throw error;
      setFeedbackSent(valor);
      toast.success(valor === "ok" ? "Gracias, marcado como correcto" : "Gracias, marcado para ajuste manual");
    } catch (e: any) {
      toast.error("Error: " + (e?.message ?? String(e)));
    } finally {
      setFeedbackBusy(false);
    }
  };

  const a = data?.analysis;
  const cat = data?.catastro;
  const plano = cat?.plano_url;
  const pages: string[] = Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : [];
  const pdfUrl: string | null = cat?.plantas_pdf_url ?? null;
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

  const reanalizar = async () => {
    setBusy("re");
    try {
      const { error } = await supabase.functions.invoke("analyze-building-vision", {
        body: { building_id: buildingId },
      });
      if (error) throw error;
      toast.success("Re-analizado");
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
  const escP01 = a.n_escaleras_en_piso01;
  const escBaja = a.n_escaleras_en_planta_baja;
  const vivTipo = a.viviendas_por_planta_tipo;
  const locBaja = a.n_locales_planta_baja;
  const almSot = a.n_almacenes_sotano;
  const patios = a.patios_detectados;
  const accesos = Array.isArray(a.accesos_codigos) ? a.accesos_codigos.length : null;

  const tienePages = pages.length > 0;
  const escFraseHotelero = escP01 != null
    ? ` ${escP01} ${escP01 === 1 ? "escalera" : "escaleras"} en PISO 01 (clave para cambio uso hotelero, criterio normativa Madrid)`
    : " escaleras en PISO 01 no detectadas";
  const explicacion = tienePages
    ? `Analicé las ${pages.length} plantas del edificio: en el PISO 01 detecté${escFraseHotelero}` +
      `${vivTipo != null ? `, ${vivTipo} viviendas tipo` : ""}` +
      `${patios != null ? `, ${patios} patios` : ""}.` +
      ` En planta baja hay ${locBaja ?? "—"} locales comerciales` +
      `${accesos != null ? ` y ${accesos} accesos` : ""}` +
      `${almSot != null ? `, ${almSot} almacenes en sótano` : ""}` +
      `${a.tiene_azotea_transitable ? ", azotea transitable" : ""}.` +
      ` Modelo: ${a.modelo_usado}${a.modelo_fallback ? " (fallback)" : ""}. Confianza ${conf}. Tiempo: ${dur}.`
    : `Analicé el croquis catastral (PDF de plantas no disponible). Detecté ${patios ?? 0} patios, parcela ${a.esquina ? "en esquina" : "no esquina"}, ${a.segundas_escaleras ? "≥2 cajas de escaleras" : "1 caja de escaleras"}. Modelo: ${a.modelo_usado}${a.modelo_fallback ? " (fallback)" : ""}. Confianza ${conf}. Tiempo: ${dur}.`;

  const pageLabel = (i: number) => {
    if (pages.length <= 1) return `Plano`;
    if (i === 0) return "Pág 1 · Vista general";
    if (i === 1) return "Pág 2 · Planta BAJA";
    if (i === pages.length - 1) return `Pág ${i + 1} · SÓTANO`;
    return `Pág ${i + 1} · PISO ${String(i - 1).padStart(2, "0")}`;
  };

  return (
    <>
      <Card>
        <CardHeader>
          <Eyebrow><ScanSearch className="mr-1 inline h-3 w-3" /> Análisis del plano catastral</Eyebrow>
          <CardTitle>🔍 Análisis del plano catastral</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-foreground">{explicacion}</p>

          {tienePages && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Eyebrow>{pages.length} páginas del PDF de distribución por plantas</Eyebrow>
                {pdfUrl && (
                  <Button asChild size="sm" variant="outline">
                    <a href={pdfUrl} target="_blank" rel="noreferrer">
                      <FileText className="h-3 w-3" /> Abrir PDF completo ↗
                    </a>
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
                {pages.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPageZoom({ url, label: pageLabel(i) })}
                    className="group block overflow-hidden rounded-md border border-border-faint bg-white text-left transition hover:border-gold"
                  >
                    <img src={url} alt={pageLabel(i)} loading="lazy" className="aspect-[3/4] w-full object-contain" />
                    <div className="bg-surface-1 px-2 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground group-hover:text-gold">
                      {pageLabel(i)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tienePages && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <MiniStat label="ESC piso 01" value={escP01} accent={escP01 != null && escP01 >= 2} />
              <MiniStat label="ESC planta baja" value={escBaja} />
              <MiniStat label="Viv./planta tipo" value={vivTipo} />
              <MiniStat label="Locales baja" value={locBaja} />
              <MiniStat label="Almacenes sótano" value={almSot} />
              <MiniStat label="Sótano" value={a.tiene_sotano == null ? "—" : a.tiene_sotano ? "Sí" : "No"} />
              <MiniStat label="Azotea transit." value={a.tiene_azotea_transitable == null ? "—" : a.tiene_azotea_transitable ? "Sí" : "No"} />
              <MiniStat label="Patios" value={patios} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setModalOpen(true)} disabled={!plano && pages.length === 0}>
              <Eye className="h-3 w-3" /> Ver plano procesado con anotaciones
            </Button>
            <Button size="sm" variant="outline" onClick={() => reanalizar()} disabled={busy !== null}>
              {busy === "re" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Re-analizar plano
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

          {/* Bloque auditable de ventanas a patio */}
          {(a.patios_detectados != null || a.ventanas_patios_estimadas != null) && (
            <div className="rounded-md border border-cyan-400/30 bg-cyan-400/5 p-3 text-xs">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-cyan-300">
                Estimación de ventanas a patio · fórmula determinista
              </div>
              <p className="leading-relaxed text-foreground">
                Plano catastral detectó <strong>{a.patios_detectados ?? "—"}</strong> patios
                {Array.isArray(a.ventanas_patios_desglose) && a.ventanas_patios_desglose.length > 0 && (
                  <>
                    {" "}con códigos{" "}
                    <span className="font-mono text-[11px]">
                      [{a.ventanas_patios_desglose
                        .map((p: any) => {
                          const paredes = p.paredes != null ? `${p.paredes}p` : "";
                          const area = p.area_m2 != null ? `${Math.round(p.area_m2)}m²` : "";
                          const v = p.ventanas_estimadas != null ? `→${p.ventanas_estimadas}v` : "";
                          return `${p.codigo}(${[paredes, area].filter(Boolean).join(",")}${v})`;
                        })
                        .join(", ")}]
                    </span>
                  </>
                )}
                .{" "}
                Aplicando heurística calibrada:{" "}
                <strong>{a.ventanas_patios_estimadas ?? a.ventanas_patios_total ?? "—"}</strong>{" "}
                ventanas a patio estimadas.
              </p>
              {a.formula_ventanas_patio && (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {a.formula_ventanas_patio}
                </p>
              )}
              {a.aviso_ventanas && (
                <p className="mt-2 rounded-sm border border-border-faint bg-surface-1/50 p-2 text-[11px] text-muted-foreground">
                  ⚠ {a.aviso_ventanas}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  ¿Coincide con lo que ves en Google Earth oblicua?
                </span>
                <Button
                  size="sm"
                  variant={feedbackSent === "ok" ? "gold" : "outline"}
                  onClick={() => enviarFeedback("ok")}
                  disabled={feedbackBusy || feedbackSent !== null}
                >
                  <ThumbsUp className="h-3 w-3" /> Sí, correcto
                </Button>
                <Button
                  size="sm"
                  variant={feedbackSent === "ajuste" ? "gold" : "outline"}
                  onClick={() => enviarFeedback("ajuste")}
                  disabled={feedbackBusy || feedbackSent !== null}
                >
                  <ThumbsDown className="h-3 w-3" /> No, ajustar manualmente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {pages.length > 0 ? "PISO 01 · anotaciones IA" : "Plano catastral · anotaciones IA"}
            </DialogTitle>
          </DialogHeader>
          <PlanoAnotado planoUrl={pages[2] ?? pages[0] ?? plano} anotaciones={anotaciones} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!pageZoom} onOpenChange={(v) => !v && setPageZoom(null)}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle>{pageZoom?.label}</DialogTitle>
          </DialogHeader>
          {pageZoom && (
            <div className="max-h-[80vh] overflow-auto rounded-md border border-border-faint bg-white">
              <img src={pageZoom.url} alt={pageZoom.label} className="block w-full" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-2">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-base tabular-nums ${accent ? "text-gold" : "text-foreground"}`}>
        {value == null || value === "" ? "—" : String(value)}
      </div>
    </div>
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
          La IA no devolvió anotaciones en este análisis. Re-analiza para forzar un nuevo etiquetado.
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
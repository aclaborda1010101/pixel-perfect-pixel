import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Loader2, ExternalLink, FileText, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotaSimple } from "@/hooks/useNotasSimples";
import { toast } from "sonner";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

function RiesgoBadge({ r }: { r: string | null }) {
  if (!r) return null;
  const v = r === "alto" ? "danger" : r === "medio" ? "warning" : "success";
  return <Badge variant={v as any}>Riesgo {r}</Badge>;
}

function fmtPct(p?: number | null) {
  if (p == null) return null;
  return `${p}%`;
}

export default function NotaSimpleDetail() {
  const { id } = useParams<{ id: string }>();
  const { nota, pdfUrl, loading, reanalyze, reload } = useNotaSimple(id);
  const [busy, setBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfHeaders, setPdfHeaders] = useState<Record<string, string> | null>(null);
  const [pdfDiagError, setPdfDiagError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const measure = () => setPanelWidth(panelRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!pdfUrl) {
      setPdfStatus(null);
      setPdfHeaders(null);
      setPdfDiagError(null);
      return;
    }

    const ctrl = new AbortController();
    const run = async () => {
      try {
        const res = await fetch(pdfUrl, { method: "HEAD", signal: ctrl.signal });
        const picked = {
          "content-type": res.headers.get("content-type") ?? "",
          "content-disposition": res.headers.get("content-disposition") ?? "",
          "cache-control": res.headers.get("cache-control") ?? "",
          "accept-ranges": res.headers.get("accept-ranges") ?? "",
        };
        console.info("[nota-simple-pdf] HEAD", { status: res.status, headers: picked, url: pdfUrl });
        setPdfStatus(String(res.status));
        setPdfHeaders(picked);
        setPdfDiagError(null);
      } catch (error: any) {
        if (ctrl.signal.aborted) return;
        console.warn("[nota-simple-pdf] HEAD failed", error);
        setPdfDiagError(error?.message ?? "HEAD failed");
      }
    };

    run();
    return () => ctrl.abort();
  }, [pdfUrl]);

  const pageWidth = useMemo(() => Math.max(panelWidth - 32, 280), [panelWidth]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando…
    </div>;
  }
  if (!nota) return <div className="p-6">Nota no encontrada.</div>;

  const sj = nota.structured_json ?? {};
  const dir = nota.building?.direccion ?? "Sin edificio";
  const propietario = nota.owner?.nombre ?? "—";

  const onReanalyze = async () => {
    setBusy(true);
    try { await reanalyze(); toast.success("Reanalizando…"); }
    catch (e: any) { toast.error(e?.message ?? "Error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/notas-simples"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </Button>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>{dir}</CardTitle>
              <div className="text-sm text-muted-foreground mt-1">
                {nota.building?.ciudad && <span>{nota.building.ciudad} · </span>}
                <span>Propietario: {propietario}</span>
                <span> · {new Date(nota.created_at).toLocaleString("es-ES")}</span>
              </div>
              {sj.riesgo_justificacion && (
                <div className="text-sm mt-2 max-w-2xl">{sj.riesgo_justificacion}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <RiesgoBadge r={nota.riesgo} />
              <Badge variant="outline">{nota.status}</Badge>
              {(nota.status === "error" || nota.status === "listo") && (
                <Button size="sm" variant="outline" onClick={onReanalyze} disabled={busy}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Reanalizar
                </Button>
              )}
            </div>
          </div>
          {nota.error_message && (
            <div className="mt-2 text-sm text-destructive">Error: {nota.error_message}</div>
          )}
        </CardHeader>
      </Card>

      {/* Body: PDF izda, structured dcha */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* PDF viewer (oculto en mobile, botón overlay) */}
        <div className="hidden lg:block">
          <Card className="h-[80vh]">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> PDF</CardTitle>
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noreferrer" className="text-xs flex items-center gap-1 text-primary hover:underline">
                  Abrir <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </CardHeader>
            <CardContent className="h-[calc(80vh-60px)] overflow-auto p-4" ref={panelRef}>
              {pdfUrl ? (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    <span>HEAD {pdfStatus ?? "…"}</span>
                    {pdfHeaders?.["content-type"] && <span> · {pdfHeaders["content-type"]}</span>}
                    {pdfDiagError && <span className="text-destructive"> · {pdfDiagError}</span>}
                  </div>
                  <Document
                    file={pdfUrl}
                    loading={<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando PDF…</div>}
                    error={<div className="py-6 text-sm text-destructive">No se ha podido renderizar el PDF.</div>}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    onLoadError={(error) => {
                      console.error("[nota-simple-pdf] render error", error);
                      toast.error("No se ha podido abrir el PDF");
                    }}
                    className="flex flex-col items-center gap-4"
                  >
                    <Page
                      pageNumber={1}
                      width={pageWidth}
                      renderAnnotationLayer
                      renderTextLayer
                      loading={<div className="py-8 text-sm text-muted-foreground">Preparando primera página…</div>}
                    />
                  </Document>
                  {numPages && numPages > 1 && <div className="text-xs text-muted-foreground">Mostrando página 1 de {numPages}</div>}
                </div>
              ) : <div className="p-4 text-sm text-muted-foreground">Sin PDF</div>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {nota.status === "procesando" && (
            <Card><CardContent className="p-6 flex items-center gap-3 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando con IA…
            </CardContent></Card>
          )}

          {sj.finca && Object.keys(sj.finca).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Finca</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                {sj.finca.numero && <div><span className="text-muted-foreground">N.º registral: </span>{sj.finca.numero}</div>}
                {sj.finca.registro && <div><span className="text-muted-foreground">Registro: </span>{sj.finca.registro}</div>}
                {sj.finca.ref_catastral && <div><span className="text-muted-foreground">Ref. catastral: </span>{sj.finca.ref_catastral}</div>}
                {sj.superficie_m2 != null && <div><span className="text-muted-foreground">Superficie: </span>{sj.superficie_m2} m²</div>}
                {sj.fecha_emision_nota && <div><span className="text-muted-foreground">Fecha emisión: </span>{sj.fecha_emision_nota}</div>}
                {sj.divisible != null && <div><span className="text-muted-foreground">Divisible: </span>{sj.divisible ? "Sí" : "No"}</div>}
              </CardContent>
            </Card>
          )}

          {sj.titulares?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Titulares ({sj.titulares.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sj.titulares.map((t: any, i: number) => (
                  <div key={i} className="flex items-start justify-between border border-border-faint rounded p-2 text-sm">
                    <div>
                      <div className="font-medium">{t.nombre}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.cif_dni && <span>{t.cif_dni}</span>}
                        {t.rol && <span className="ml-2">· {t.rol.replace("_", " ")}</span>}
                      </div>
                    </div>
                    {t.porcentaje != null && <Badge variant="outline">{fmtPct(t.porcentaje)}</Badge>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {sj.cargas?.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Cargas ({sj.cargas.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {sj.cargas.map((c: any, i: number) => (
                  <div key={i} className="border border-border-faint rounded p-2 text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{c.tipo}</Badge>
                      {c.importe != null && <span className="text-xs">{Number(c.importe).toLocaleString("es-ES")} €</span>}
                      {c.fecha && <span className="text-xs text-muted-foreground">· {c.fecha}</span>}
                    </div>
                    {c.acreedor && <div className="text-xs"><span className="text-muted-foreground">Acreedor:</span> {c.acreedor}</div>}
                    {c.notas && <div className="text-xs text-muted-foreground">{c.notas}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {sj.linderos && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Linderos</CardTitle></CardHeader>
              <CardContent className="text-sm">{sj.linderos}</CardContent>
            </Card>
          )}

          {/* PDF en mobile */}
          <div className="lg:hidden">
            {pdfUrl && (
              <Button variant="outline" className="w-full" onClick={() => setPdfOpen(true)}>
                <Eye className="h-4 w-4" /> Ver PDF
              </Button>
            )}
          </div>

          {/* JSON crudo */}
          {sj && Object.keys(sj).length > 0 && (
            <details className="rounded border border-border-faint p-3 text-xs">
              <summary className="cursor-pointer text-muted-foreground">Ver JSON estructurado</summary>
              <pre className="mt-2 overflow-auto bg-surface-1/30 p-2 rounded">{JSON.stringify(sj, null, 2)}</pre>
            </details>
          )}
        </div>
      </div>

      {/* PDF overlay mobile */}
      {pdfOpen && pdfUrl && (
        <div className="fixed inset-0 z-50 bg-background lg:hidden">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div className="text-sm font-medium">PDF</div>
            <Button size="sm" variant="ghost" onClick={() => setPdfOpen(false)}>Cerrar</Button>
          </div>
          <div className="h-[calc(100vh-49px)] overflow-auto p-3">
            <Document
              file={pdfUrl}
              loading={<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando PDF…</div>}
              error={<div className="py-6 text-sm text-destructive">No se ha podido renderizar el PDF.</div>}
              onLoadError={(error) => console.error("[nota-simple-pdf] mobile render error", error)}
              className="flex flex-col items-center gap-4"
            >
              <Page pageNumber={1} width={Math.max(window.innerWidth - 24, 280)} renderAnnotationLayer renderTextLayer />
            </Document>
          </div>
        </div>
      )}
    </div>
  );
}
import { useCallback, useEffect, useState } from "react";
import { FileText, Upload, Loader2, AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Nota = {
  id: string;
  file_url: string | null;
  status: string;
  riesgo: string | null;
  structured_json: any;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

const riesgoVariant = (r: string | null) =>
  r === "alto" ? "danger" : r === "medio" ? "warning" : r === "bajo" ? "success" : "outline";

const statusVariant = (s: string) =>
  s === "listo" ? "success" : s === "error" ? "danger" : s === "procesando" ? "info" : "outline";

export default function NotasSimples() {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Nota | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notas_simples")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast.error(error.message);
    else setNotas((data ?? []) as Nota[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Realtime updates
  useEffect(() => {
    const ch = supabase
      .channel("notas_simples_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "notas_simples" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
          toast.error(`${file.name}: solo PDF`);
          continue;
        }
        const path = `${crypto.randomUUID()}-${file.name}`;
        const up = await supabase.storage.from("notas-simples").upload(path, file, {
          contentType: "application/pdf",
        });
        if (up.error) { toast.error(up.error.message); continue; }
        const { data: nota, error: insErr } = await supabase
          .from("notas_simples")
          .insert({ file_url: path, status: "pendiente" })
          .select("*").single();
        if (insErr || !nota) { toast.error(insErr?.message ?? "Error"); continue; }
        // trigger analysis (fire and forget)
        supabase.functions.invoke("analyze_nota_simple", { body: { nota_id: nota.id } })
          .then(({ error }) => { if (error) toast.error(error.message); });
        toast.success(`${file.name} subido, analizando…`);
      }
      await load();
    } finally {
      setUploading(false);
    }
  };

  const reanalyze = async (id: string) => {
    await supabase.from("notas_simples").update({ status: "pendiente", error_message: null }).eq("id", id);
    const { error } = await supabase.functions.invoke("analyze_nota_simple", { body: { nota_id: id } });
    if (error) toast.error(error.message);
    else toast.success("Reanalizando…");
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Captación" title="Notas Simples" subtitle="Sube notas simples del Registro y extrae titulares, cargas y riesgo." />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />Subir nota simple (PDF)</CardTitle></CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-border rounded-md p-8 cursor-pointer hover:bg-surface-1/30 transition">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Arrastra o haz clic para subir uno o varios PDF</div>
            <input type="file" accept="application/pdf" multiple className="hidden" disabled={uploading}
              onChange={(e) => onUpload(e.target.files)} />
            {uploading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Subiendo…</div>}
          </label>
        </CardContent>
      </Card>

      {notas.length === 0 ? (
        <EmptyState icon={FileText} title="Sin notas todavía" description="Sube tu primera nota simple para empezar." />
      ) : (
        <Card>
          <CardHeader><CardTitle>Notas analizadas ({notas.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {notas.map((n) => {
              const sj = n.structured_json ?? {};
              const dir = sj?.finca?.direccion ?? n.file_url ?? "—";
              return (
                <div key={n.id} className="flex items-center justify-between gap-3 rounded border border-border-faint p-3">
                  <button className="flex-1 text-left space-y-1" onClick={() => setSelected(n)}>
                    <div className="text-sm font-medium truncate">{dir}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={statusVariant(n.status) as any}>
                        {n.status === "procesando" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        {n.status === "listo" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {n.status === "error" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {n.status === "pendiente" && <Clock className="h-3 w-3 mr-1" />}
                        {n.status}
                      </Badge>
                      {n.riesgo && <Badge variant={riesgoVariant(n.riesgo) as any}>Riesgo {n.riesgo}</Badge>}
                      {sj?.cargas?.length > 0 && <span>{sj.cargas.length} cargas</span>}
                      {sj?.titulares?.length > 0 && <span>· {sj.titulares.length} titulares</span>}
                    </div>
                    {n.error_message && <div className="text-xs text-destructive">{n.error_message}</div>}
                  </button>
                  {(n.status === "error" || n.status === "listo") && (
                    <Button variant="ghost" size="sm" onClick={() => reanalyze(n.id)}>
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Detalle</span>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Cerrar</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {selected.structured_json?.resumen && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Resumen</div>
                <div>{selected.structured_json.resumen}</div>
              </div>
            )}
            {selected.structured_json?.finca && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Finca</div>
                <pre className="text-xs bg-surface-1/30 p-2 rounded overflow-auto">{JSON.stringify(selected.structured_json.finca, null, 2)}</pre>
              </div>
            )}
            {selected.structured_json?.titulares?.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Titulares</div>
                <ul className="list-disc pl-5">
                  {selected.structured_json.titulares.map((t: any, i: number) => (
                    <li key={i}>{t.nombre} {t.nif && `(${t.nif})`} {t.cuota && `— ${t.cuota}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {selected.structured_json?.cargas?.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Cargas</div>
                <ul className="space-y-1">
                  {selected.structured_json.cargas.map((c: any, i: number) => (
                    <li key={i} className="border border-border-faint rounded p-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{c.tipo}</Badge>
                        {c.importe && <span className="text-xs">{c.importe.toLocaleString("es-ES")} €</span>}
                      </div>
                      <div className="text-xs mt-1">{c.descripcion}</div>
                      {c.acreedor && <div className="text-xs text-muted-foreground">{c.acreedor}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {selected.structured_json?.riesgo_motivos?.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-1">Motivos del riesgo</div>
                <ul className="list-disc pl-5">
                  {selected.structured_json.riesgo_motivos.map((m: string, i: number) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

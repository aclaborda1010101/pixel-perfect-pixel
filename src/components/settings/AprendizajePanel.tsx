import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { Brain, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function AprendizajePanel() {
  const [rows, setRows] = useState<any[]>([]);
  const [resumen, setResumen] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("building_feedback")
      .select("id, building_id, dimension, estado, texto, analisis_ia, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data as any) || []));
  }, []);

  const byDim = rows.reduce<Record<string, number>>((acc, r) => { acc[r.dimension || "sin_clasificar"] = (acc[r.dimension || "sin_clasificar"] || 0) + 1; return acc; }, {});
  const byEstado = rows.reduce<Record<string, number>>((acc, r) => { acc[r.estado] = (acc[r.estado] || 0) + 1; return acc; }, {});
  const codeQueue = rows.filter((r) => r.estado === "requiere_codigo");

  const patterns = (() => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      const k = `${r.dimension || "otro"} · ${r.analisis_ia?.origen || "?"}`;
      map[k] = (map[k] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  })();

  async function resumenSemanal() {
    setBusy(true);
    setResumen("");
    try {
      const sample = rows.slice(0, 50).map((r) => ({ dimension: r.dimension, estado: r.estado, diagnostico: r.analisis_ia?.diagnostico, texto: r.texto?.slice(0, 200) }));
      const url = `https://${(import.meta as any).env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/agent_voss_coach`;
      // Reusamos endpoint AI vía proxy: simplificado, llamamos a un edge function existente o devolvemos client-side resumen vía fetch al gateway desde edge. Para mvp, lo construimos textual sin LLM.
      const counts = `Total: ${rows.length}. Por dimensión: ${Object.entries(byDim).map(([k,v]) => `${k}:${v}`).join(", ")}. Por estado: ${Object.entries(byEstado).map(([k,v]) => `${k}:${v}`).join(", ")}.`;
      const top = patterns.slice(0, 3).map(([k,v]) => `• ${k} (${v} casos)`).join("\n");
      setResumen(`${counts}\n\nPatrones más frecuentes:\n${top}\n\n${codeQueue.length ? `⚠ ${codeQueue.length} feedbacks requieren cambio de código.` : "Sin tareas de ingeniería pendientes."}`);
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally { setBusy(false); }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><Brain className="mr-1 inline h-3 w-3" /> Aprendizaje</Eyebrow>
        <CardTitle>Correcciones del equipo · {rows.length} feedbacks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
          {Object.entries(byEstado).map(([k, v]) => (
            <div key={k} className="rounded border p-2">
              <div className="text-xs text-muted-foreground">{k}</div>
              <div className="text-lg font-medium">{v}</div>
            </div>
          ))}
        </div>

        <div>
          <Eyebrow>Por dimensión</Eyebrow>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(byDim).map(([k, v]) => (
              <Badge key={k} variant="outline">{k} · {v}</Badge>
            ))}
          </div>
        </div>

        <div>
          <Eyebrow>Patrones detectados</Eyebrow>
          <ul className="mt-1 text-sm space-y-0.5">
            {patterns.map(([k, v]) => <li key={k}>• {k} <span className="text-muted-foreground">({v})</span></li>)}
          </ul>
        </div>

        {codeQueue.length > 0 && (
          <div>
            <Eyebrow className="text-destructive"><AlertTriangle className="mr-1 inline h-3 w-3" /> Cola de ingeniería</Eyebrow>
            <ul className="mt-1 text-sm space-y-1">
              {codeQueue.slice(0, 10).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border-faint pb-1">
                  <span className="truncate flex-1">{r.texto}</span>
                  <Link to={`/comercial/edificios/${r.building_id}`} className="text-xs underline">ver</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={resumenSemanal} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Resumen semanal
          </Button>
        </div>
        {resumen && <pre className="whitespace-pre-wrap text-xs bg-muted/40 p-3 rounded">{resumen}</pre>}
      </CardContent>
    </Card>
  );
}
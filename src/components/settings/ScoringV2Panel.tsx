import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Brain, Loader2, Play, Upload, KeyRound } from "lucide-react";

export function ScoringV2Panel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: settings } = useQuery({
    queryKey: ["app_settings_all"],
    queryFn: async () => {
      const { data } = await (supabase.from("app_settings" as any) as any).select("*");
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => (map[r.key] = r.value));
      return map;
    },
  });

  const { data: jobs } = useQuery({
    queryKey: ["scoring_v2_jobs_recent"],
    refetchInterval: running ? 2000 : false,
    queryFn: async () => {
      const { data } = await (supabase.from("scoring_v2_jobs" as any) as any)
        .select("*").order("started_at", { ascending: false }).limit(10);
      return (data ?? []) as any[];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["scoring_v2_stats"],
    queryFn: async () => {
      const { count: total } = await (supabase.from("buildings" as any) as any).select("id", { count: "exact", head: true });
      const { count: withScore } = await (supabase.from("buildings" as any) as any).select("id", { count: "exact", head: true }).not("score_v2", "is", null);
      const { count: withCatastro } = await (supabase.from("catastro_data" as any) as any).select("refcatastral", { count: "exact", head: true });
      const { count: withAnalysis } = await (supabase.from("building_analysis" as any) as any).select("id", { count: "exact", head: true });
      return { total: total ?? 0, withScore: withScore ?? 0, withCatastro: withCatastro ?? 0, withAnalysis: withAnalysis ?? 0 };
    },
  });

  const enabled = settings?.scoring_v2_enabled === true;

  const toggleFlag = async (next: boolean) => {
    const { error } = await (supabase.from("app_settings" as any) as any)
      .upsert({ key: "scoring_v2_enabled", value: next, updated_at: new Date().toISOString() });
    if (error) { toast.error(error.message); return; }
    toast.success(`Scoring v2 ${next ? "activado" : "desactivado"}`);
    qc.invalidateQueries({ queryKey: ["app_settings_all"] });
    qc.invalidateQueries({ queryKey: ["app_settings", "scoring_v2_enabled"] });
  };

  const runBatch = async (phase: "catastro" | "google" | "vision" | "full") => {
    setRunning(phase);
    try {
      let cursor: string | null = null;
      let job_id: string | null = null;
      let totalProcessed = 0;
      let totalFailed = 0;
      // loop hasta has_more=false
      for (let i = 0; i < 200; i++) {
        const { data, error } = await supabase.functions.invoke("batch-pipeline-scoring-v2", {
          body: { phase, cursor, job_id },
        });
        if (error) throw error;
        job_id = (data as any).job_id;
        cursor = (data as any).next_cursor;
        totalProcessed += (data as any).processed ?? 0;
        totalFailed += (data as any).failed ?? 0;
        qc.invalidateQueries({ queryKey: ["scoring_v2_jobs_recent"] });
        if (!(data as any).has_more) break;
      }
      toast.success(`Batch ${phase}: ${totalProcessed} OK · ${totalFailed} fallidos`);
      qc.invalidateQueries({ queryKey: ["scoring_v2_stats"] });
    } catch (e: any) {
      toast.error("Batch error: " + (e?.message ?? String(e)));
    } finally {
      setRunning(null);
    }
  };

  const validateGoogleKey = async () => {
    setValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-google-imagery", { body: { ping: true } });
      if (error) throw error;
      if ((data as any)?.ok) toast.success("GOOGLE_MAPS_API_KEY válida");
      else toast.error("Clave inválida o no configurada");
    } catch (e: any) {
      toast.error("Validación falló: " + (e?.message ?? String(e)));
    } finally {
      setValidating(false);
    }
  };

  const uploadCsv = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      const { data, error } = await supabase.functions.invoke("seed-edificios-import", {
        body: text,
        headers: { "content-type": "text/csv" },
      });
      if (error) throw error;
      const d = data as any;
      toast.success(`Seed cargado: ${d?.matched ?? 0} matched / ${d?.unmatched?.length ?? 0} sin match`);
      qc.invalidateQueries({ queryKey: ["scoring_v2_stats"] });
    } catch (e: any) {
      toast.error("Upload falló: " + (e?.message ?? String(e)));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <Eyebrow><Brain className="mr-1 inline h-3 w-3" /> Scoring v2</Eyebrow>
          <CardTitle>Scoring v2 — Configuración</CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Activado</span>
          <Switch checked={enabled} onCheckedChange={toggleFlag} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Edificios totales" value={stats?.total ?? 0} />
          <Kpi label="Con Catastro" value={stats?.withCatastro ?? 0} />
          <Kpi label="Con análisis IA" value={stats?.withAnalysis ?? 0} />
          <Kpi label="Con score v2" value={stats?.withScore ?? 0} accent />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-faint bg-surface-1/40 p-3">
          <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">GOOGLE_MAPS_API_KEY</span>
          <Button size="sm" variant="outline" disabled={validating} onClick={validateGoogleKey}>
            {validating ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Validar
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadCsv(f);
              }}
            />
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              Subir CSV seed
            </Button>
          </div>
        </div>

        {enabled ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["catastro", "Batch Catastro"],
                ["google", "Batch Imagery"],
                ["vision", "Batch Vision"],
                ["full", "Recompute full"],
              ] as const).map(([p, label]) => (
                <Button
                  key={p}
                  variant="outline"
                  size="sm"
                  disabled={running !== null}
                  onClick={() => runBatch(p)}
                >
                  {running === p ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  {label}
                </Button>
              ))}
            </div>

            <div className="space-y-1">
              <Eyebrow>Últimos jobs</Eyebrow>
              <div className="rounded-md border border-border-faint">
                {(jobs ?? []).length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Sin jobs aún.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="border-b border-border-faint text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Fase</th>
                        <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Estado</th>
                        <th className="px-3 py-2 text-right font-mono uppercase tracking-eyebrow">OK</th>
                        <th className="px-3 py-2 text-right font-mono uppercase tracking-eyebrow">Fail</th>
                        <th className="px-3 py-2 text-right font-mono uppercase tracking-eyebrow">Inicio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-faint">
                      {jobs!.map((j: any) => (
                        <tr key={j.id}>
                          <td className="px-3 py-2 font-mono">{j.phase}</td>
                          <td className="px-3 py-2"><Badge variant={j.status === "done" ? "success" : j.status === "running" ? "info" : "outline"}>{j.status}</Badge></td>
                          <td className="px-3 py-2 text-right tabular-nums">{j.processed}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-400">{j.failed}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{j.started_at ? new Date(j.started_at).toLocaleString("es") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">
            Activa el flag para empezar a usar Scoring v2 sin afectar al scoring v1 existente.
            La clave <code>GOOGLE_MAPS_API_KEY</code> ya está configurada. La IA usa Lovable AI Gateway
            (Gemini 2.5 Flash primario, Gemini 3.5 Flash fallback) — no requiere ningún secret extra.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${accent ? "text-gold" : "text-foreground"}`}>{String(value)}</div>
    </div>
  );
}
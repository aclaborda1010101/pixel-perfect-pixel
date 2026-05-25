import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type ItemStatus = {
  building_id: string;
  direccion?: string | null;
  status: "pending" | "running" | "ok" | "error";
  phase?: string;
  error?: string | null;
  score?: number | null;
};

const PHASE_LABELS: Record<string, string> = {
  starting: "Iniciando",
  catastro: "A · Catastro PDF",
  google: "B · Google Imagery",
  vision: "C · Análisis IA Vision",
  score: "D · Score unificado",
  done: "Completado",
  cartera_demo: "Cartera Demo",
};

export default function JobProgressPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const notifiedRef = useRef(false);

  const { data: job } = useQuery({
    queryKey: ["scoring_v2_job", jobId],
    enabled: !!jobId,
    refetchInterval: (q) => {
      const j = (q.state.data as any) ?? null;
      if (j && (j.status === "done" || j.status === "aborted")) return false;
      return 2000;
    },
    queryFn: async () => {
      const { data } = await (supabase.from("scoring_v2_jobs" as any) as any)
        .select("*").eq("id", jobId).single();
      return data;
    },
  });

  const items: ItemStatus[] = useMemo(() => (job?.items_status as any) ?? [], [job]);
  const phaseProgress: Record<string, { ok: number; failed: number }> =
    (job?.phase_progress as any) ?? {};
  const total = job?.total ?? items.length;
  const okCount = items.filter((i) => i.status === "ok").length;
  const errCount = items.filter((i) => i.status === "error").length;
  const withScore = items.filter((i) => i.score != null).length;
  // Confianza media: pedimos a buildings.confianza_media de los items procesados
  const { data: confianzaData } = useQuery({
    queryKey: ["job_confianza", jobId, okCount],
    enabled: items.length > 0,
    queryFn: async () => {
      const ids = items.map((i) => i.building_id);
      const { data } = await (supabase.from("buildings" as any) as any)
        .select("confianza_media").in("id", ids);
      const vals = (data ?? []).map((r: any) => r.confianza_media).filter((v: any) => typeof v === "number");
      if (!vals.length) return null;
      return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    },
  });

  useEffect(() => {
    if (!job || notifiedRef.current) return;
    if (job.status === "done") {
      notifiedRef.current = true;
      toast.success(`Cartera demo procesada: ${total} edificios · ${okCount} OK · ${errCount} errores`);
      setTimeout(() => navigate("/comercial/edificios?filter=cartera_demo"), 1500);
    } else if (job.status === "aborted") {
      notifiedRef.current = true;
      toast.error(`Procesamiento abortado: ${job.error ?? "demasiados fallos"}`);
    }
  }, [job, total, okCount, errCount, navigate]);

  if (!job) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isRunning = job.status === "running";
  const isDone = job.status === "done";
  const isAborted = job.status === "aborted";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          eyebrow="Procesamiento end-to-end"
          title={`Job ${String(jobId).slice(0, 8)}…`}
          subtitle={`Fase actual: ${PHASE_LABELS[job.current_phase ?? "starting"] ?? job.current_phase ?? "—"}`}
        />
        <Button variant="outline" size="sm" onClick={() => navigate("/ajustes")}>
          <ArrowLeft className="mr-1 h-3 w-3" /> Volver a ajustes
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Estado" value={
          isRunning ? "Procesando" : isDone ? "Completado" : isAborted ? "Abortado" : job.status
        } accent={isDone} danger={isAborted} />
        <Kpi label="Procesados" value={`${okCount} / ${total}`} accent={isDone} />
        <Kpi label="Errores" value={errCount} danger={errCount > 0} />
        <Kpi
          label="Confianza media"
          value={confianzaData != null ? `${Math.round(confianzaData * 100)}%` : "—"}
          accent={confianzaData != null && confianzaData >= 0.7}
          danger={confianzaData != null && confianzaData < 0.5}
        />
      </div>

      <Card>
        <CardHeader>
          <Eyebrow><Clock className="mr-1 inline h-3 w-3" /> Progreso por fase</Eyebrow>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(["catastro", "google", "vision", "score"] as const).map((p) => {
            const prog = phaseProgress[p] ?? { ok: 0, failed: 0 };
            const done = prog.ok + prog.failed;
            const pct = total > 0 ? (done / total) * 100 : 0;
            const isCurrent = job.current_phase === p;
            return (
              <div key={p} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={cn("font-mono uppercase tracking-eyebrow", isCurrent ? "text-gold" : "text-muted-foreground")}>
                    {PHASE_LABELS[p]} {isCurrent && "·"} {isCurrent && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {prog.ok} OK · {prog.failed} fail · {done}/{total}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-1">
                  <div
                    className={cn("h-full transition-all",
                      prog.failed > prog.ok ? "bg-red-500/70" : "bg-emerald-500/70")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Eyebrow>Edificios</Eyebrow>
          <CardTitle>{items.length} en proceso</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border-faint bg-surface-1 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Estado</th>
                  <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Dirección</th>
                  <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Fase</th>
                  <th className="px-3 py-2 text-right font-mono uppercase tracking-eyebrow">Score</th>
                  <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-faint">
                {items.map((it) => (
                  <tr key={it.building_id}>
                    <td className="px-3 py-2">
                      {it.status === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                      {it.status === "error" && <XCircle className="h-4 w-4 text-red-500" />}
                      {it.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-gold" />}
                      {it.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground/50" />}
                    </td>
                    <td className="px-3 py-2 text-foreground">{it.direccion ?? it.building_id.slice(0, 8)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{it.phase ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {it.score != null ? Number(it.score).toFixed(1) : "—"}
                    </td>
                    <td className="px-3 py-2 text-red-400">{it.error ?? ""}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Cargando…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isAborted && job.error && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="p-4 text-sm text-red-400">
            <strong>Job abortado:</strong> {job.error}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value, accent, danger }: { label: string; value: any; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl tabular-nums",
        danger ? "text-red-400" : accent ? "text-gold" : "text-foreground")}>{String(value)}</div>
    </div>
  );
}
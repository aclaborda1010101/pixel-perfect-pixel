import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { RefreshCw, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { JobsManualPanel } from "@/components/settings/JobsManualPanel";
import { HubspotPanel } from "@/components/settings/HubspotPanel";
import { AnalisisIAPanel } from "@/components/settings/AnalisisIAPanel";

const PHASE_ORDER = ["catastro", "geometry", "google", "corner", "proteccion", "iee", "score", "cluster"] as const;
const PHASE_LABEL: Record<string, string> = {
  catastro: "Catastro",
  geometry: "Geometría parcela",
  google: "Fotos Google",
  corner: "Esquina",
  proteccion: "Protección PGOU",
  iee: "IEE/ITE",
  score: "Score",
  cluster: "Cluster",
};

type Health = {
  total: number;
  sin_barrio: number;
  sin_mala_gestion: number;
  sin_n_escaleras_final: number;
  sin_foto: number;
  sin_score: number;
  errores_ultima_sync: number;
};

function useHealth() {
  return useQuery({
    queryKey: ["admin_sync_health"],
    refetchInterval: 30000,
    queryFn: async (): Promise<Health> => {
      const [
        { count: total },
        { count: sin_barrio },
        { count: sin_mala_gestion },
        { count: sin_n_escaleras_final },
        { count: sin_score },
        { data: withImg },
        { count: errores },
      ] = await Promise.all([
        (supabase.from("building_analysis" as any) as any).select("building_id", { count: "exact", head: true }),
        (supabase.from("buildings" as any) as any).select("id", { count: "exact", head: true }).is("cluster_asignado", null),
        (supabase.from("building_analysis" as any) as any).select("building_id", { count: "exact", head: true }).is("mala_gestion_score", null),
        (supabase.from("building_analysis" as any) as any).select("building_id", { count: "exact", head: true }).is("n_escaleras_final", null),
        (supabase.from("buildings" as any) as any).select("id", { count: "exact", head: true }).is("score", null),
        (supabase.from("building_imagery" as any) as any).select("building_id"),
        (supabase.from("building_processing_status" as any) as any).select("building_id", { count: "exact", head: true }).eq("status", "error"),
      ]);
      const withImageIds = new Set(((withImg as any[]) ?? []).map((r) => r.building_id));
      const { data: bas } = await (supabase.from("building_analysis" as any) as any).select("building_id");
      const sin_foto = ((bas as any[]) ?? []).filter((r) => !withImageIds.has(r.building_id)).length;
      return {
        total: total ?? 0,
        sin_barrio: sin_barrio ?? 0,
        sin_mala_gestion: sin_mala_gestion ?? 0,
        sin_n_escaleras_final: sin_n_escaleras_final ?? 0,
        sin_foto,
        sin_score: sin_score ?? 0,
        errores_ultima_sync: errores ?? 0,
      };
    },
  });
}

function useActiveJob(jobId: string | null) {
  return useQuery({
    queryKey: ["admin_sync_job", jobId],
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
}

export default function AdminSync() {
  const { isAdmin, loading } = useCurrentRole();
  const health = useHealth();
  const [mode, setMode] = useState<"stale" | "all" | "custom">("stale");
  const [customIds, setCustomIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [hsJobs, setHsJobs] = useState<Record<string, { status: "pending" | "running" | "ok" | "error"; error?: string }>>({});
  const [hsBusy, setHsBusy] = useState(false);

  const job = useActiveJob(jobId);

  const items: any[] = useMemo(() => (job.data as any)?.items_status ?? [], [job.data]);
  const phaseProgress: Record<string, { ok: number; failed: number }> = (job.data as any)?.phase_progress ?? {};

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  async function launchSync() {
    setBusy(true);
    setJobId(null);
    try {
      const body: Record<string, unknown> = { force: false };
      if (mode === "all") body.all_cohort = true;
      else if (mode === "stale") { body.all_cohort = true; body.only_stale = true; }
      else {
        const ids = customIds.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
        if (!ids.length) { toast.error("Añade al menos un building_id"); setBusy(false); return; }
        body.building_ids = ids;
      }
      const { data, error } = await supabase.functions.invoke("sync_building_pipeline", { body });
      if (error) throw error;
      const jid = (data as any)?.job_id;
      if (!jid) {
        toast.info("Nada que sincronizar", { description: JSON.stringify(data).slice(0, 160) });
      } else {
        setJobId(jid);
        toast.success(`Sincronización lanzada (${(data as any)?.total} edificios)`);
      }
    } catch (e: any) {
      toast.error("Error lanzando sincronización", { description: String(e?.message ?? e).slice(0, 200) });
    } finally {
      setBusy(false);
    }
  }

  async function launchHubspot() {
    setHsBusy(true);
    const steps = ["hubspot_sync_contacts", "hubspot_sync_deals", "hubspot_sync_associations", "hubspot_sync_communications"];
    setHsJobs(Object.fromEntries(steps.map((s) => [s, { status: "pending" }])));
    for (const s of steps) {
      setHsJobs((prev) => ({ ...prev, [s]: { status: "running" } }));
      try {
        const { error } = await supabase.functions.invoke(s, { body: {} });
        if (error) throw error;
        setHsJobs((prev) => ({ ...prev, [s]: { status: "ok" } }));
      } catch (e: any) {
        setHsJobs((prev) => ({ ...prev, [s]: { status: "error", error: String(e?.message ?? e).slice(0, 200) } }));
      }
    }
    setHsBusy(false);
    toast.success("Sincronización HubSpot terminada");
  }

  const running = job.data && (job.data as any).status === "running";
  const done = job.data && (job.data as any).status === "done";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Sincronización"
        subtitle="Un solo botón: se sincronizan los edificios y ya."
      />

      {/* Salud de datos */}
      <Card>
        <CardHeader>
          <Eyebrow>Salud de datos</Eyebrow>
          <CardTitle>Cohorte de edificios analizados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Kpi label="Totales" value={health.data?.total ?? "…"} />
            <Kpi label="Sin barrio" value={health.data?.sin_barrio ?? "…"} danger={(health.data?.sin_barrio ?? 0) > 0} />
            <Kpi label="Sin mala_gestion" value={health.data?.sin_mala_gestion ?? "…"} danger={(health.data?.sin_mala_gestion ?? 0) > 0} />
            <Kpi label="Sin nº escaleras" value={health.data?.sin_n_escaleras_final ?? "…"} danger={(health.data?.sin_n_escaleras_final ?? 0) > 0} />
            <Kpi label="Sin foto" value={health.data?.sin_foto ?? "…"} danger={(health.data?.sin_foto ?? 0) > 0} />
            <Kpi label="Sin score" value={health.data?.sin_score ?? "…"} danger={(health.data?.sin_score ?? 0) > 0} />
            <Kpi label="Errores última sync" value={health.data?.errores_ultima_sync ?? "…"} danger={(health.data?.errores_ultima_sync ?? 0) > 0} />
          </div>
        </CardContent>
      </Card>

      {/* Botón único: Sincronizar edificios */}
      <Card>
        <CardHeader>
          <Eyebrow><RefreshCw className="mr-1 inline h-3 w-3" /> Edificios</Eyebrow>
          <CardTitle>Sincronizar edificios</CardTitle>
          <p className="text-xs text-muted-foreground">
            Encadena catastro → geometría → fotos → esquina → protección → IEE → score → cluster. Cada fase se salta si el dato es reciente (&lt;7 días).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border-faint">
              {(["stale", "all", "custom"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-3 py-1.5 text-xs font-mono uppercase tracking-eyebrow",
                    mode === m ? "bg-gold/20 text-gold" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "stale" ? "Solo desactualizados" : m === "all" ? "Todos" : "Seleccionar"}
                </button>
              ))}
            </div>
            <Button size="sm" variant="gold" onClick={launchSync} disabled={busy || running}>
              {busy || running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              {busy ? "Lanzando…" : running ? "Sincronizando…" : "Sincronizar edificios"}
            </Button>
          </div>
          {mode === "custom" && (
            <textarea
              value={customIds}
              onChange={(e) => setCustomIds(e.target.value)}
              placeholder="building_ids separados por coma o salto de línea"
              className="min-h-[80px] w-full rounded border border-border/50 bg-surface-1 p-2 text-xs font-mono"
            />
          )}

          {job.data && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi label="Estado" value={(job.data as any).status} accent={done} danger={(job.data as any).status === "aborted"} />
                <Kpi label="Procesados" value={`${(job.data as any).processed ?? 0} / ${(job.data as any).total ?? 0}`} accent={done} />
                <Kpi label="Errores" value={(job.data as any).failed ?? 0} danger={((job.data as any).failed ?? 0) > 0} />
                <Kpi label="Fase actual" value={PHASE_LABEL[(job.data as any).current_phase] ?? (job.data as any).current_phase ?? "—"} />
              </div>

              <div className="space-y-1">
                {PHASE_ORDER.map((p) => {
                  const prog = phaseProgress[p] ?? { ok: 0, failed: 0 };
                  const done_p = prog.ok + prog.failed;
                  const total = (job.data as any).total ?? 0;
                  const pct = total > 0 ? (done_p / total) * 100 : 0;
                  return (
                    <div key={p} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono uppercase tracking-eyebrow text-muted-foreground">{PHASE_LABEL[p]}</span>
                        <span className="font-mono tabular-nums text-muted-foreground">{prog.ok} OK · {prog.failed} fail · {done_p}/{total}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
                        <div className={cn("h-full transition-all", prog.failed > prog.ok ? "bg-red-500/70" : "bg-emerald-500/70")} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="max-h-[400px] overflow-auto rounded border border-border/50">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 border-b border-border-faint bg-surface-1 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left"></th>
                      <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Dirección</th>
                      <th className="px-3 py-2 text-left font-mono uppercase tracking-eyebrow">Fase</th>
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
                        <td className="px-3 py-2 font-mono text-muted-foreground">{PHASE_LABEL[it.phase ?? ""] ?? it.phase ?? "—"}</td>
                        <td className="px-3 py-2 text-red-400">{it.error ?? ""}</td>
                      </tr>
                    ))}
                    {items.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Preparando…</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* HubSpot */}
      <Card>
        <CardHeader>
          <Eyebrow>HubSpot</Eyebrow>
          <CardTitle>Sincronizar HubSpot</CardTitle>
          <p className="text-xs text-muted-foreground">
            Encadena contacts → deals → associations → communications.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" variant="gold" onClick={launchHubspot} disabled={hsBusy}>
            {hsBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
            Sincronizar HubSpot
          </Button>
          {Object.keys(hsJobs).length > 0 && (
            <div className="space-y-1">
              {Object.entries(hsJobs).map(([fn, st]) => (
                <div key={fn} className="flex items-center justify-between rounded border border-border/50 bg-surface-1 px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    {st.status === "ok" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                    {st.status === "error" && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                    {st.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />}
                    {st.status === "pending" && <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />}
                    <span className="font-mono text-foreground">{fn}</span>
                  </div>
                  {st.error && <span className="truncate text-red-400" title={st.error}>{st.error}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Avanzado (colapsado) */}
      <Accordion type="single" collapsible>
        <AccordionItem value="advanced" className="rounded border border-border/50 bg-surface-1/30 px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span>Avanzado (uso técnico)</span>
              <Badge variant="outline" className="border-amber-500/40 text-amber-400">Sólo si sabes lo que haces</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-4">
            <div className="grid gap-4">
              <HubspotPanel />
              <div className="grid gap-4 md:grid-cols-2">
                <JobsManualPanel />
                <AnalisisIAPanel />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Kpi({ label, value, accent, danger }: { label: string; value: any; accent?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl tabular-nums", danger ? "text-red-400" : accent ? "text-gold" : "text-foreground")}>{String(value)}</div>
    </div>
  );
}
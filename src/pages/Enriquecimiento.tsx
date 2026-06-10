import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Play, RefreshCw, Eye, Check, X } from "lucide-react";

type Job = any;

const ESTADO_VARIANT: Record<string, any> = {
  pendiente: "secondary",
  en_curso: "info",
  esperando_navegador: "warning",
  requiere_revision: "warning",
  requiere_humano: "warning",
  ok: "success",
  error: "destructive",
  descartado: "outline",
};

const TIPOLOGIAS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10"];

export default function Enriquecimiento() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [browserConfigured, setBrowserConfigured] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [verify, setVerify] = useState<Job | null>(null);
  const [showContract, setShowContract] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("enrichment_jobs" as any)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) { toast.error(error.message); setLoading(false); return; }
    setJobs(data ?? []);
    setLoading(false);
    // detectar si hay jobs esperando_navegador → asumimos no configurado
    const waiting = (data ?? []).some((j: any) => j.estado === "esperando_navegador");
    setBrowserConfigured(!waiting);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const ch = supabase.channel("enrichment_jobs_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "enrichment_jobs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const kpis = useMemo(() => {
    const c: Record<string, number> = {};
    jobs.forEach(j => { c[j.estado] = (c[j.estado] || 0) + 1; });
    return c;
  }, [jobs]);

  const grouped = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of jobs) {
      const k = j.building_id ?? "sin-edificio";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(j);
    }
    return Array.from(m.entries());
  }, [jobs]);

  const reintentar = async (jobId: string) => {
    await supabase.from("enrichment_jobs" as any).update({
      estado: "pendiente", next_attempt_at: new Date().toISOString(), error: null,
    }).eq("id", jobId);
    await supabase.functions.invoke("enrichment-agent", { body: {} });
    toast.success("Reintento lanzado");
  };

  const forzarRevision = async (jobId: string) => {
    await supabase.from("enrichment_jobs" as any).update({
      estado: "requiere_humano", fase: "verificacion",
    }).eq("id", jobId);
    toast.success("Marcado para revisión humana");
  };

  const cancelar = async (jobId: string) => {
    await supabase.from("enrichment_jobs" as any).update({ estado: "descartado" }).eq("id", jobId);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Operaciones" title="Enriquecimiento de titulares" subtitle="Cola autónoma con verificación humana antes de HubSpot" />

      {browserConfigured === false && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">Navegador headless no configurado</div>
              <p className="text-muted-foreground mt-1">
                Los jobs de Inglobaly quedan en <code>esperando_navegador</code>. Crea una cuenta en{" "}
                <a className="underline" href="https://www.browserless.io" target="_blank" rel="noreferrer">Browserless</a>{" "}
                (o Browserbase) y guarda el WSS en el secret <code>BROWSER_WSS_URL</code>, junto a{" "}
                <code>INGLOBALY_USER</code> e <code>INGLOBALY_PASS</code>. Una vez configurado, los jobs se reanudan automáticamente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {["pendiente","en_curso","esperando_navegador","requiere_revision","requiere_humano","ok","error","descartado"].map(e => (
          <Card key={e}>
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">{e.replace(/_/g, " ")}</div>
              <div className="text-2xl font-semibold">{kpis[e] ?? 0}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Cola por edificio</CardTitle>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Recargar
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {grouped.length === 0 && <div className="text-sm text-muted-foreground">Sin jobs aún.</div>}
          {grouped.map(([bid, items]) => (
            <div key={bid} className="border rounded-lg">
              <div className="px-3 py-2 bg-muted/30 text-xs font-mono">
                Edificio: {bid} · {items.length} job{items.length > 1 ? "s" : ""}
              </div>
              <div className="divide-y">
                {items.map((j: Job) => (
                  <div key={j.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-[220px]">
                      <div className="font-medium">{j.titular_nombre}</div>
                      <div className="text-xs text-muted-foreground">
                        {j.titular_tipo} · fase {j.fase} · intentos {j.intentos}/{j.max_intentos}
                        {j.error && <span className="text-destructive ml-2">· {j.error}</span>}
                      </div>
                    </div>
                    <Badge variant={ESTADO_VARIANT[j.estado] ?? "outline"}>{j.estado}</Badge>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(j)}><Eye className="h-3.5 w-3.5" /></Button>
                      {j.estado !== "ok" && j.estado !== "descartado" && (
                        <Button size="sm" variant="ghost" onClick={() => reintentar(j.id)}><RefreshCw className="h-3.5 w-3.5" /></Button>
                      )}
                      {j.fase === "verificacion" || j.estado === "requiere_humano" || j.estado === "requiere_revision" ? (
                        <Button size="sm" variant="gold" onClick={() => setVerify(j)}>Verificar</Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => forzarRevision(j.id)}>→ Humano</Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => cancelar(j.id)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <Collapsible open={showContract} onOpenChange={setShowContract}>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex flex-row items-center justify-between">
              <CardTitle className="text-base">Contrato API operador externo (fallback)</CardTitle>
              <ChevronDown className={`h-4 w-4 transition ${showContract ? "rotate-180" : ""}`} />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="text-sm space-y-2">
              <p className="text-muted-foreground">Solo se usa si el agente autónomo está caído. Header <code>x-enrichment-key: ENRICHMENT_API_KEY</code>.</p>
              <pre className="bg-muted p-3 rounded overflow-auto text-xs">{`# Tomar jobs pendientes
GET /functions/v1/enrichment-jobs-api?action=pending&fase=inglobaly&limit=5
→ { lease_token, jobs: [{ id, titular_nombre, titular_nif, datos, ... }] }

# Subir resultado
POST /functions/v1/enrichment-jobs-api?action=result
{ "job_id": "...", "lease_token": "...", "resultado": { nif, fecha_nacimiento, domicilios, co_domicilios } }
# o en caso de fallo:
{ "job_id": "...", "lease_token": "...", "error": "selector no encontrado" }`}</pre>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <JobDetailDialog job={selected} onClose={() => setSelected(null)} />
      <VerifyDialog job={verify} onClose={() => setVerify(null)} onDone={load} />
    </div>
  );
}

function JobDetailDialog({ job, onClose }: { job: Job | null; onClose: () => void }) {
  const [signedUrls, setSignedUrls] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const shots = job?.datos?.screenshots ?? [];
      if (!shots.length) { setSignedUrls([]); return; }
      const urls = await Promise.all(shots.map(async (s: any) => {
        const { data } = await supabase.storage.from("enrichment-evidence").createSignedUrl(s.path, 3600);
        return data?.signedUrl ?? "";
      }));
      setSignedUrls(urls.filter(Boolean));
    })();
  }, [job]);

  if (!job) return null;
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{job.titular_nombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge>{job.fase}</Badge>
            <Badge variant={ESTADO_VARIANT[job.estado]}>{job.estado}</Badge>
            {job.titular_nif && <Badge variant="outline">{job.titular_nif}</Badge>}
          </div>
          {signedUrls.length > 0 && (
            <div>
              <div className="font-medium mb-1">Evidencia ({signedUrls.length} screenshot{signedUrls.length>1?"s":""})</div>
              <div className="grid grid-cols-2 gap-2">
                {signedUrls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img src={u} className="rounded border" /></a>)}
              </div>
            </div>
          )}
          <div>
            <div className="font-medium mb-1">Payload</div>
            <pre className="bg-muted p-2 rounded text-xs overflow-auto max-h-80">{JSON.stringify(job.datos, null, 2)}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ job, onClose, onDone }: { job: Job | null; onClose: () => void; onDone: () => void }) {
  const [overrides, setOverrides] = useState<any>({});
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job) return;
    setOverrides({
      nombre: job.titular_nombre,
      nif: job.datos?.inglobaly?.nif ?? job.titular_nif ?? "",
      fecha_nacimiento: job.datos?.inglobaly?.fecha_nacimiento ?? "",
      domicilio: job.datos?.inglobaly?.domicilios?.[0]?.direccion ?? "",
      cargo: job.datos?.cargo ?? "",
      tipologia: job.datos?.tipologia ?? "T9",
      pct: job.titular_pct ?? null,
      co_domicilios: job.datos?.inglobaly?.co_domicilios ?? [],
    });
  }, [job]);

  const aplicar = async (decision: "aprobada" | "rechazada") => {
    if (!job) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("enrichment-apply-verification", {
      body: { job_id: job.id, decision, overrides, motivo },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(decision === "aprobada" ? "Aprobado y aplicado" : "Rechazado");
    onDone(); onClose();
  };

  if (!job) return null;
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Verificación T1-T10 · {job.titular_nombre}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <Field label="Nombre"><Input value={overrides.nombre ?? ""} onChange={e => setOverrides({...overrides, nombre: e.target.value})} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="NIF"><Input value={overrides.nif ?? ""} onChange={e => setOverrides({...overrides, nif: e.target.value})} /></Field>
            <Field label="Fecha nacimiento (YYYY-MM-DD)"><Input value={overrides.fecha_nacimiento ?? ""} onChange={e => setOverrides({...overrides, fecha_nacimiento: e.target.value})} /></Field>
          </div>
          <Field label="Domicilio"><Input value={overrides.domicilio ?? ""} onChange={e => setOverrides({...overrides, domicilio: e.target.value})} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cargo"><Input value={overrides.cargo ?? ""} onChange={e => setOverrides({...overrides, cargo: e.target.value})} /></Field>
            <Field label="Tipología">
              <Select value={overrides.tipologia} onValueChange={(v) => setOverrides({...overrides, tipologia: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOLOGIAS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {overrides.co_domicilios?.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-eyebrow text-muted-foreground mb-1">Co-domicilios (T8 sin confirmar)</div>
              <div className="space-y-1">
                {overrides.co_domicilios.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                    <input type="checkbox" defaultChecked
                      onChange={(e) => {
                        const next = [...overrides.co_domicilios];
                        if (!e.target.checked) next.splice(i, 1);
                        setOverrides({ ...overrides, co_domicilios: next });
                      }} />
                    <span className="font-medium">{c.nombre}</span>
                    {c.nif && <span className="text-muted-foreground">{c.nif}</span>}
                    <span className="text-muted-foreground ml-auto">{c.direccion}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Field label="Motivo (si rechazas)"><Textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => aplicar("rechazada")} disabled={busy}><X className="h-3.5 w-3.5 mr-1" /> Rechazar</Button>
          <Button variant="gold" onClick={() => aplicar("aprobada")} disabled={busy}><Check className="h-3.5 w-3.5 mr-1" /> Aprobar y aplicar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-eyebrow text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
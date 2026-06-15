import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { PageHeader } from "@/components/common/PageHeader";
import { Loader2, RefreshCcw, Sparkles } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useAuth } from "@/hooks/useAuth";

type Row = {
  comercial: string;
  llamadas_total: number;
  llamadas_scoreadas: number;
  hitos_medios: number | null;
  pct_tipologia: number | null;
  pct_que_le_mueve: number | null;
  pct_info_edificio: number | null;
  pct_canal_abierto: number | null;
  score_post_call_medio: number | null;
  dur_lt_30: number;
  dur_30_60: number;
  dur_60_90: number;
  dur_gt_90: number;
  dur_desconocida: number;
};

type Global = Omit<Row, "comercial"> & { llamadas_total: number };

type CoachReport = {
  id: string;
  comercial_hs_id: string | null;
  week_start: string;
  week_end: string;
  fortalezas: any;
  mejoras: any;
  frases_ganadoras: string[];
  plan_accion: any;
  total_calls: number;
  metricas: any;
  generated_at: string;
};

const COACH_WINDOWS = [
  { key: "7d",   label: "Última semana",   days: 7 },
  { key: "30d",  label: "Último mes",      days: 30 },
  { key: "90d",  label: "Últimos 3 meses", days: 90 },
  { key: "365d", label: "Último año",      days: 365 },
];
const COACH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(1)}%`;
}
function num(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(digits);
}
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

function comercialLabel(email: string) {
  if (!email) return "—";
  if (email === "(sin_comercial)") return "Sin asignar";
  return email.replace(/@.*$/, "");
}

export default function Productividad() {
  const { user } = useAuth();
  const { isComercial } = useCurrentRole();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [global, setGlobal] = useState<Global | null>(null);
  const [queueRemaining, setQueueRemaining] = useState<number | null>(null);

  // Coach IA (per-comercial)
  const [selOwner, setSelOwner] = useState<string>("all");
  const [coachWindow, setCoachWindow] = useState<string>("30d");
  const [coachCache, setCoachCache] = useState<Record<string, CoachReport>>({});
  const [coachLoadingKey, setCoachLoadingKey] = useState<string | null>(null);
  const [hsIdByEmail, setHsIdByEmail] = useState<Record<string, { id: string; nombre: string }>>({});

  async function load() {
    setLoading(true);
    const [r1, r2, r3] = await Promise.all([
      supabase.from("v_productividad_comercial").select("*").order("llamadas_total", { ascending: false }),
      supabase.from("v_productividad_global").select("*").maybeSingle(),
      // cola pendiente de scoring de hitos
      supabase.from("calls").select("id", { count: "exact", head: true })
        .not("transcripcion", "is", null).neq("transcripcion", ""),
    ]);
    if (r1.error) toast.error(`Vista comerciales: ${r1.error.message}`);
    if (r2.error) toast.error(`Vista global: ${r2.error.message}`);
    let data = (r1.data ?? []) as Row[];
    if (isComercial && user?.email) data = data.filter(d => d.comercial === user.email);
    setRows(data);
    setGlobal((r2.data as any) ?? null);
    setQueueRemaining(r3.count ?? null);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isComercial, user?.email]);

  // Cargar mapa comercial_email → hs_owner_id (para Coach IA, que indexa por hs_id)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("calls")
        .select("comercial_email, comercial_hs_id, comercial_nombre")
        .not("comercial_hs_id", "is", null)
        .not("comercial_email", "is", null)
        .limit(2000);
      const map: Record<string, { id: string; nombre: string }> = {};
      for (const c of (data ?? []) as any[]) {
        if (c.comercial_email && c.comercial_hs_id && !map[c.comercial_email]) {
          map[c.comercial_email] = { id: c.comercial_hs_id, nombre: c.comercial_nombre || comercialLabel(c.comercial_email) };
        }
      }
      setHsIdByEmail(map);
    })();
  }, []);

  async function rescore() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("score-calls-historical", { body: {} });
      if (error) throw error;
      toast.success(`Scoring lanzado: ${data?.processed ?? 0} procesadas · ${data?.queue_remaining ?? 0} pendientes en cola`);
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(`Error: ${e?.message ?? e}`);
    } finally { setRefreshing(false); }
  }

  async function loadCoachFor(email: string, windowKey: string, opts: { force?: boolean } = {}) {
    const info = hsIdByEmail[email];
    if (!info) { toast.error("Sin hs_owner_id mapeado para este comercial"); return; }
    const win = COACH_WINDOWS.find(w => w.key === windowKey)!;
    const cacheKey = `${info.id}_${windowKey}`;
    const from = isoDay(daysAgo(win.days));
    const to = isoDay(new Date());
    if (!opts.force) {
      const mem = coachCache[cacheKey];
      if (mem && Date.now() - new Date(mem.generated_at).getTime() < COACH_CACHE_TTL_MS) return;
      const { data: existing } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", info.id).eq("week_start", from).maybeSingle();
      if (existing && Date.now() - new Date(existing.generated_at).getTime() < COACH_CACHE_TTL_MS) {
        setCoachCache(prev => ({ ...prev, [cacheKey]: existing as CoachReport }));
        return;
      }
    }
    setCoachLoadingKey(cacheKey);
    try {
      const { error } = await supabase.functions.invoke("generate_coach_report", {
        body: { from, to, comercial_hs_id: info.id },
      });
      if (error) throw error;
      const { data: fresh } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", info.id).eq("week_start", from).maybeSingle();
      if (fresh) setCoachCache(prev => ({ ...prev, [cacheKey]: fresh as CoachReport }));
    } catch (e: any) {
      toast.error(`Error generando coach: ${e?.message ?? e}`);
    } finally { setCoachLoadingKey(null); }
  }

  useEffect(() => {
    if (selOwner !== "all") loadCoachFor(selOwner, coachWindow);
    // eslint-disable-next-line
  }, [selOwner, coachWindow]);

  const coachInfo = selOwner !== "all" ? hsIdByEmail[selOwner] : null;
  const currentCoachKey = coachInfo ? `${coachInfo.id}_${coachWindow}` : null;
  const currentCoachReport = currentCoachKey ? coachCache[currentCoachKey] : undefined;
  const currentCoachLoading = currentCoachKey != null && coachLoadingKey === currentCoachKey;

  const totales = useMemo(() => {
    if (global) return global;
    // fallback agregando filas
    const acc: Global = {
      llamadas_total: 0, llamadas_scoreadas: 0, hitos_medios: 0,
      pct_tipologia: 0, pct_que_le_mueve: 0, pct_info_edificio: 0, pct_canal_abierto: 0,
      score_post_call_medio: 0,
      dur_lt_30: 0, dur_30_60: 0, dur_60_90: 0, dur_gt_90: 0, dur_desconocida: 0,
    };
    for (const r of rows) {
      acc.llamadas_total += r.llamadas_total;
      acc.llamadas_scoreadas += r.llamadas_scoreadas;
      acc.dur_lt_30 += r.dur_lt_30; acc.dur_30_60 += r.dur_30_60;
      acc.dur_60_90 += r.dur_60_90; acc.dur_gt_90 += r.dur_gt_90;
      acc.dur_desconocida += (r.dur_desconocida || 0);
    }
    return acc;
  }, [global, rows]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Productividad comercial"
        subtitle="Calidad de llamada por hitos conseguidos (tipología, motivación, info edificio, canal abierto). Duración como dato diagnóstico."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={rescore} disabled={refreshing} size="sm" variant="outline">
          {refreshing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
          Reanalizar pendientes
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground">
          {(totales.llamadas_scoreadas ?? 0).toLocaleString()} scoreadas · {(totales.llamadas_total ?? 0).toLocaleString()} llamadas con transcripción
          {queueRemaining != null && <> · {queueRemaining.toLocaleString()} con transcripción en total</>}
        </div>
      </div>

      {/* KPIs globales – hitos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Hitos medios / llamada" value={num(totales.hitos_medios, 2)} hint="0–4 hitos" />
        <Kpi label="Score medio" value={num(totales.score_post_call_medio, 1)} hint="0–100 (hits × 25)" />
        <Kpi label="% Tipología" value={pct(totales.pct_tipologia)} />
        <Kpi label="% Qué le mueve" value={pct(totales.pct_que_le_mueve)} />
        <Kpi label="% Info edificio" value={pct(totales.pct_info_edificio)} />
        <Kpi label="% Canal abierto" value={pct(totales.pct_canal_abierto)} />
      </div>

      <Tabs defaultValue="comerciales" className="space-y-4">
        <TabsList>
          <TabsTrigger value="comerciales">Calidad por comercial</TabsTrigger>
          <TabsTrigger value="duracion">Duración (diagnóstico)</TabsTrigger>
          <TabsTrigger value="coach">Coach IA</TabsTrigger>
        </TabsList>

        <TabsContent value="comerciales">
          <Card>
            <CardHeader><CardTitle className="text-sm">Hitos conseguidos por comercial</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercial</TableHead>
                    <TableHead className="text-right">Llamadas</TableHead>
                    <TableHead className="text-right">Scoreadas</TableHead>
                    <TableHead className="text-right">Hitos / llam.</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">% Tipo.</TableHead>
                    <TableHead className="text-right">% Mueve</TableHead>
                    <TableHead className="text-right">% Edif.</TableHead>
                    <TableHead className="text-right">% Canal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground">{loading ? "Cargando…" : "Sin datos"}</TableCell></TableRow>
                  )}
                  {rows.map(r => (
                    <TableRow key={r.comercial}>
                      <TableCell className="font-medium">{comercialLabel(r.comercial)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.llamadas_total.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.llamadas_scoreadas.toLocaleString()}
                        {r.llamadas_scoreadas === 0 && <Badge variant="outline" className="ml-2 text-[9px]">sin scoring</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.hitos_medios, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(r.score_post_call_medio, 1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.pct_tipologia)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.pct_que_le_mueve)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.pct_info_edificio)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.pct_canal_abierto)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="duracion">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Distribución de duración (diagnóstico — no afecta al score)</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercial</TableHead>
                    <TableHead className="text-right">&lt; 30s</TableHead>
                    <TableHead className="text-right">30–60s</TableHead>
                    <TableHead className="text-right">60–90s</TableHead>
                    <TableHead className="text-right">&gt; 90s</TableHead>
                    <TableHead>Distribución</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const tot = r.dur_lt_30 + r.dur_30_60 + r.dur_60_90 + r.dur_gt_90;
                    const seg = (n: number, cls: string) => tot > 0 ? (
                      <span className={`inline-block h-2 ${cls}`} style={{ width: `${(n/tot)*100}%` }} />
                    ) : null;
                    return (
                      <TableRow key={r.comercial}>
                        <TableCell className="font-medium">{comercialLabel(r.comercial)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.dur_lt_30}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.dur_30_60}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.dur_60_90}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.dur_gt_90}</TableCell>
                        <TableCell>
                          <div className="flex h-2 w-40 overflow-hidden rounded bg-surface-1">
                            {seg(r.dur_lt_30, "bg-rose-500")}
                            {seg(r.dur_30_60, "bg-amber-500")}
                            {seg(r.dur_60_90, "bg-sky-500")}
                            {seg(r.dur_gt_90, "bg-emerald-500")}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Una llamada larga sin hitos no puntúa. Una corta con hitos puntúa. Este bloque es solo para entender cuánto tiempo invierte cada comercial.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="coach" className="space-y-3">
          {!isComercial && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Comercial</span>
              <Select value={selOwner} onValueChange={setSelOwner}>
                <SelectTrigger className="h-9 w-[260px]"><SelectValue placeholder="Selecciona" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Selecciona un comercial…</SelectItem>
                  {rows.filter(r => hsIdByEmail[r.comercial]).map(r => (
                    <SelectItem key={r.comercial} value={r.comercial}>{comercialLabel(r.comercial)} · {r.llamadas_total}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {selOwner === "all" ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              Selecciona un comercial para ver su análisis Coach IA.
            </CardContent></Card>
          ) : (
            <Tabs value={coachWindow} onValueChange={setCoachWindow}>
              <div className="flex items-center justify-between gap-2">
                <TabsList>
                  {COACH_WINDOWS.map(w => <TabsTrigger key={w.key} value={w.key}>{w.label}</TabsTrigger>)}
                </TabsList>
                <Button size="sm" variant="outline" disabled={currentCoachLoading}
                  onClick={() => loadCoachFor(selOwner, coachWindow, { force: true })}>
                  {currentCoachLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Regenerar
                </Button>
              </div>
              <div className="mt-3">
                {currentCoachLoading ? (
                  <Card><CardContent className="p-6 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Generando Coach IA…
                  </CardContent></Card>
                ) : currentCoachReport ? (
                  <CoachCard report={currentCoachReport} nombre={coachInfo?.nombre || selOwner} />
                ) : (
                  <Card><CardContent className="p-6 text-sm text-muted-foreground">Sin datos en este periodo.</CardContent></Card>
                )}
              </div>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function CoachCard({ report, nombre }: { report: CoachReport; nombre: string }) {
  const m = report.metricas || {};
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {nombre}
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">{report.week_start} → {report.week_end}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="text-muted-foreground">
          {report.total_calls} llamadas analizadas
        </div>
        {Array.isArray(report.fortalezas) && report.fortalezas.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Fortalezas</div>
            <ul className="space-y-1">
              {report.fortalezas.map((f: any, i: number) => (
                <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(report.mejoras) && report.mejoras.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-amber-500">Mejoras</div>
            <ul className="space-y-1">
              {report.mejoras.map((f: any, i: number) => (
                <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(report.frases_ganadoras) && report.frases_ganadoras.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Frases ganadoras</div>
            <ul className="space-y-1">
              {report.frases_ganadoras.map((f: string, i: number) => (
                <li key={i} className="border-l-2 border-emerald-500/40 pl-2">{f}</li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(report.plan_accion) && report.plan_accion.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-primary">Plan de acción</div>
            <ul className="space-y-1">
              {report.plan_accion.map((p: any, i: number) => (
                <li key={i}><strong>{p.titulo}</strong> — <span className="text-muted-foreground">{p.detalle}</span></li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
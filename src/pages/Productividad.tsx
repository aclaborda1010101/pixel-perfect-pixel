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

// ============== Tipos ==============
type HitRow = {
  comercial: string;
  llamadas_total: number;
  llamadas_scoreadas: number;
  hitos_medios: number | null;
  pct_tipologia: number | null;
  pct_que_le_mueve: number | null;
  pct_info_edificio: number | null;
  pct_canal_abierto: number | null;
  score_post_call_medio: number | null;
  dur_lt_30: number; dur_30_60: number; dur_60_90: number; dur_gt_90: number; dur_desconocida: number;
};
type Global = Omit<HitRow, "comercial">;

type PivotMoment = {
  posicion_relativa?: number;
  estado_cliente_antes: string;
  trigger_frase: string;
  tactica: string;
  estado_cliente_despues: string;
  impacto: "alto" | "medio" | "bajo";
  objecion_neutralizada?: string | null;
};

type Call = {
  id: string;
  owner_id: string | null;
  comercial_hs_id: string | null;
  comercial_email: string | null;
  comercial_nombre: string | null;
  fecha: string;
  duracion_seg: number | null;
  outcome: string | null;
  sentiment: string | null;
  objeciones: string[] | null;
  tecnica_score: number | null;
  ratio_comercial_cliente: number | null;
  pivot_moments: PivotMoment[] | null;
  tacticas_usadas: string[] | null;
  analyzed_at: string | null;
};

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

// ============== Constantes ==============
const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };
const COACH_WINDOWS = [
  { key: "7d",   label: "Última semana",   days: 7 },
  { key: "30d",  label: "Último mes",      days: 30 },
  { key: "90d",  label: "Últimos 3 meses", days: 90 },
  { key: "365d", label: "Último año",      days: 365 },
];
const COACH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TACTICAS = [
  "preguntas_abiertas","neutralizacion_objecion","reframe","validacion_emocional",
  "prueba_social","personalizacion","urgencia_legitima","escucha_activa","cierre_directo",
];
const DAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

// ============== Helpers ==============
function pct(n: number | null | undefined) { return n == null || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toFixed(1)}%`; }
function num(n: number | null | undefined, d = 2) { return n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(d); }
function fmtSec(n: number | null) { if (!n) return "—"; const m = Math.floor(n/60), s = Math.round(n%60); return `${m}:${String(s).padStart(2,"0")}`; }
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysSince(iso: string) { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); }
function comercialLabel(email: string) { if (!email) return "—"; if (email === "(sin_comercial)") return "Sin asignar"; return email.replace(/@.*$/, ""); }

// ==================================================
export default function Productividad() {
  const { user } = useAuth();
  const { isComercial } = useCurrentRole();

  // Hits (vistas v_productividad_*)
  const [hitsRows, setHitsRows] = useState<HitRow[]>([]);
  const [global, setGlobal] = useState<Global | null>(null);
  const [pendingScoring, setPendingScoring] = useState<number | null>(null);
  const [totalScored, setTotalScored] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Classic (llamadas crudas con análisis viejo)
  const [calls, setCalls] = useState<Call[]>([]);
  const [selOwner, setSelOwner] = useState<string>("all");
  const [selRange, setSelRange] = useState<string>("90d");
  const [loadingCalls, setLoadingCalls] = useState(true);

  // Coach IA cache
  const [coachWindow, setCoachWindow] = useState<string>("30d");
  const [coachCache, setCoachCache] = useState<Record<string, CoachReport>>({});
  const [coachLoadingKey, setCoachLoadingKey] = useState<string | null>(null);

  // ---------- Hits + cola ----------
  async function loadHits() {
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from("v_productividad_comercial").select("*").order("llamadas_total", { ascending: false }),
      supabase.from("v_productividad_global").select("*").maybeSingle(),
      supabase.rpc("count_pending_scoring_calls"),
      supabase.from("calls").select("id", { count: "exact", head: true })
        .not("metadatos->post_call_scoring", "is", null),
    ]);
    if (r1.error) toast.error(`Vista comerciales: ${r1.error.message}`);
    setHitsRows((r1.data ?? []) as HitRow[]);
    setGlobal((r2.data as any) ?? null);
    setPendingScoring(Number(r3.data ?? 0));
    setTotalScored(r4.count ?? 0);
  }

  // ---------- Calls clásicas paginadas ----------
  async function loadCalls() {
    setLoadingCalls(true);
    const since = new Date(Date.now() - RANGES[selRange]*86400000).toISOString();
    const cols = "id, owner_id, comercial_hs_id, comercial_email, comercial_nombre, fecha, duracion_seg, outcome, sentiment, objeciones, tecnica_score, ratio_comercial_cliente, pivot_moments, tacticas_usadas, analyzed_at";
    const baseCount = supabase.from("calls").select("id", { count: "exact", head: true })
      .gte("fecha", since).not("analyzed_at", "is", null);
    const { count } = await baseCount;
    const PAGE = 1000;
    const total = count || 0;
    const all: Call[] = [];
    for (let from = 0; from < total; from += PAGE) {
      const to = Math.min(from + PAGE - 1, total - 1);
      const { data, error } = await supabase.from("calls")
        .select(cols).gte("fecha", since).not("analyzed_at", "is", null)
        .order("fecha", { ascending: false }).range(from, to);
      if (error) { toast.error(`Error cargando llamadas: ${error.message}`); break; }
      if (data) all.push(...((data as unknown) as Call[]));
      if (!data || data.length < PAGE) break;
    }
    setCalls(all);
    setLoadingCalls(false);
  }

  useEffect(() => { loadHits(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadCalls(); /* eslint-disable-next-line */ }, [selRange]);

  const comercialNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of calls) if (c.comercial_hs_id && c.comercial_nombre) m.set(c.comercial_hs_id, c.comercial_nombre);
    return m;
  }, [calls]);

  const hsIdByEmail = useMemo(() => {
    const m: Record<string, { id: string; nombre: string }> = {};
    for (const c of calls) {
      if (c.comercial_email && c.comercial_hs_id && !m[c.comercial_email]) {
        m[c.comercial_email] = { id: c.comercial_hs_id, nombre: c.comercial_nombre || comercialLabel(c.comercial_email) };
      }
    }
    return m;
  }, [calls]);

  const comercialesWithCalls = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of calls) {
      const k = c.comercial_hs_id || "__none__";
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, n]) => ({ id, nombre: id === "__none__" ? "Sin asignar" : (comercialNameById.get(id) || id.slice(0,8)), calls: n }))
      .sort((a,b) => b.calls - a.calls);
  }, [calls, comercialNameById]);

  const filtered = useMemo(() => {
    if (selOwner === "all") return calls;
    if (selOwner === "__none__") return calls.filter(c => !c.comercial_hs_id);
    return calls.filter(c => c.comercial_hs_id === selOwner);
  }, [calls, selOwner]);

  // Heatmap
  function buildHeatmap(filterFn?: (c: Call) => boolean) {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const c of filtered) {
      if (filterFn && !filterFn(c)) continue;
      const d = new Date(c.fecha);
      const day = (d.getDay() + 6) % 7;
      const h = d.getHours();
      grid[day][h]++;
      if (grid[day][h] > max) max = grid[day][h];
    }
    return { grid, max };
  }
  const hmAll = useMemo(() => buildHeatmap(), [filtered]);
  const hmConv = useMemo(() => buildHeatmap(c => c.outcome === "interesado"), [filtered]);

  // Comparativa clásica
  const tablaComerciales = useMemo(() => {
    const m = new Map<string, Call[]>();
    for (const c of calls) {
      const k = c.comercial_hs_id || "__none__";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).map(([cid, list]) => {
      const total = list.length;
      const inter = list.filter(c => c.outcome === "interesado").length;
      const durValid = list.filter(c => c.outcome !== "no_contestado" && c.duracion_seg && c.duracion_seg > 0).map(c => c.duracion_seg!);
      const tec = list.filter(c => c.tecnica_score != null).map(c => c.tecnica_score!);
      const ratio = list.filter(c => c.ratio_comercial_cliente != null).map(c => c.ratio_comercial_cliente!);
      const pos = list.filter(c => c.sentiment === "positivo").length;
      const ultimaFecha = list.reduce((max, c) => c.fecha > max ? c.fecha : max, list[0]?.fecha || "");
      return {
        owner_id: cid,
        nombre: cid === "__none__" ? "Sin asignar" : (comercialNameById.get(cid) || cid.slice(0,8)),
        calls: total,
        durMed: durValid.length >= 5 ? Math.round(durValid.reduce((a,b)=>a+b,0)/durValid.length) : 0,
        durN: durValid.length,
        conversion: total ? inter/total*100 : 0,
        sentPos: total ? pos/total*100 : 0,
        ratio: ratio.length ? ratio.reduce((a,b)=>a+b,0)/ratio.length : 0,
        tec: tec.length ? tec.reduce((a,b)=>a+b,0)/tec.length : 0,
        ultimaDias: ultimaFecha ? daysSince(ultimaFecha) : null,
      };
    }).filter(r => r.calls >= 10).sort((a,b) => b.conversion - a.conversion).slice(0, 20);
  }, [calls, comercialNameById]);

  // Movimientos ganadores
  const allPivots = useMemo(() => {
    const out: (PivotMoment & { call_id: string; comercial: string; fecha: string })[] = [];
    for (const c of filtered) {
      const cname = c.comercial_nombre || c.comercial_hs_id || "—";
      for (const p of (c.pivot_moments || [])) out.push({ ...p, call_id: c.id, comercial: cname, fecha: c.fecha });
    }
    return out;
  }, [filtered]);

  const tacticaStats = useMemo(() => {
    const m: Record<string, { total: number; alto: number; medio: number; bajo: number; pos: number; neg: number }> = {};
    for (const p of allPivots) {
      const t = p.tactica; if (!t) continue;
      m[t] = m[t] || { total: 0, alto: 0, medio: 0, bajo: 0, pos: 0, neg: 0 };
      const s = m[t]; s.total++;
      if (p.impacto === "alto") s.alto++; else if (p.impacto === "medio") s.medio++; else if (p.impacto === "bajo") s.bajo++;
      if (["curioso","considerando","comprometido"].includes(p.estado_cliente_despues)) s.pos++;
      else if (p.estado_cliente_despues === "cerrado_negativo") s.neg++;
    }
    return Object.entries(m).map(([tactica, s]) => ({
      tactica, ...s, ratio_alto: s.total ? +(s.alto / s.total * 100).toFixed(1) : 0,
    })).sort((a,b) => b.ratio_alto - a.ratio_alto);
  }, [allPivots]);

  // ---------- Acciones ----------
  async function rescore() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("score-calls-historical", { body: {} });
      if (error) throw error;
      toast.success(`Scoring: ${data?.processed ?? 0} procesadas · ${data?.queue_remaining ?? 0} pendientes`);
      setTimeout(loadHits, 1500);
    } catch (e: any) { toast.error(`Error: ${e?.message ?? e}`); }
    finally { setRefreshing(false); }
  }

  async function loadCoachFor(hsId: string, windowKey: string, opts: { force?: boolean } = {}) {
    if (!hsId) return;
    const win = COACH_WINDOWS.find(w => w.key === windowKey)!;
    const cacheKey = `${hsId}_${windowKey}`;
    const from = isoDay(daysAgo(win.days));
    if (!opts.force) {
      const mem = coachCache[cacheKey];
      if (mem && Date.now() - new Date(mem.generated_at).getTime() < COACH_CACHE_TTL_MS) return;
      const { data: existing } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", hsId).eq("week_start", from).maybeSingle();
      if (existing && Date.now() - new Date(existing.generated_at).getTime() < COACH_CACHE_TTL_MS) {
        setCoachCache(prev => ({ ...prev, [cacheKey]: existing as CoachReport })); return;
      }
    }
    setCoachLoadingKey(cacheKey);
    try {
      const { error } = await supabase.functions.invoke("generate_coach_report", {
        body: { from, to: isoDay(new Date()), comercial_hs_id: hsId },
      });
      if (error) throw error;
      const { data: fresh } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", hsId).eq("week_start", from).maybeSingle();
      if (fresh) setCoachCache(prev => ({ ...prev, [cacheKey]: fresh as CoachReport }));
    } catch (e: any) { toast.error(`Error coach: ${e?.message ?? e}`); }
    finally { setCoachLoadingKey(null); }
  }

  useEffect(() => {
    if (selOwner !== "all" && selOwner !== "__none__") loadCoachFor(selOwner, coachWindow);
    // eslint-disable-next-line
  }, [selOwner, coachWindow]);

  const currentCoachKey = selOwner !== "all" && selOwner !== "__none__" ? `${selOwner}_${coachWindow}` : null;
  const currentCoachReport = currentCoachKey ? coachCache[currentCoachKey] : undefined;
  const currentCoachLoading = currentCoachKey != null && coachLoadingKey === currentCoachKey;

  // Tabla de hitos filtrada (si el usuario es comercial, intentamos mapear su email)
  const myComercialEmail = useMemo(() => {
    if (!isComercial || !user?.email) return null;
    // 1) match directo
    if (hitsRows.some(r => r.comercial === user.email)) return user.email;
    // 2) match por prefijo de cuenta
    const prefix = user.email.replace(/@.*$/, "").toLowerCase();
    const hit = hitsRows.find(r => r.comercial.toLowerCase().startsWith(prefix + "@"));
    return hit?.comercial ?? null;
  }, [isComercial, user?.email, hitsRows]);

  const hitsView = useMemo(() => {
    if (isComercial && myComercialEmail) return hitsRows.filter(r => r.comercial === myComercialEmail);
    return hitsRows;
  }, [hitsRows, isComercial, myComercialEmail]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Productividad comercial"
        subtitle="Calidad por hitos conseguidos (tipología, motivación, info edificio, canal abierto) y métricas clásicas de llamada."
      />

      <div className="flex flex-wrap items-center gap-3">
        {!isComercial && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Comercial</span>
            <Select value={selOwner} onValueChange={setSelOwner}>
              <SelectTrigger className="h-9 w-[260px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {comercialesWithCalls.slice(0, 50).map(o => (
                  <SelectItem key={o.id} value={o.id}>{o.nombre} · {o.calls}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Rango</span>
          <Select value={selRange} onValueChange={setSelRange}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 días</SelectItem>
              <SelectItem value="30d">Últimos 30 días</SelectItem>
              <SelectItem value="90d">Últimos 90 días</SelectItem>
              <SelectItem value="365d">Último año</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={rescore} disabled={refreshing} size="sm" variant="outline">
          {refreshing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
          Reanalizar pendientes
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground">
          {(totalScored ?? 0).toLocaleString()} scoreadas ·{" "}
          {(pendingScoring ?? 0).toLocaleString()} pendientes hitos · {calls.length.toLocaleString()} llamadas en rango
        </div>
      </div>

      {/* KPIs globales – hitos */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Hitos / llamada" value={num(global?.hitos_medios, 2)} hint="0–4 hitos" />
        <Kpi label="Score medio" value={num(global?.score_post_call_medio, 1)} hint="hits × 25" />
        <Kpi label="% Tipología" value={pct(global?.pct_tipologia)} />
        <Kpi label="% Qué le mueve" value={pct(global?.pct_que_le_mueve)} />
        <Kpi label="% Info edificio" value={pct(global?.pct_info_edificio)} />
        <Kpi label="% Canal abierto" value={pct(global?.pct_canal_abierto)} />
      </div>

      <Tabs defaultValue="hits" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hits">Calidad (hitos)</TabsTrigger>
          <TabsTrigger value="comparativa">Comparativa clásica</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos ganadores</TabsTrigger>
          <TabsTrigger value="duracion">Duración</TabsTrigger>
          <TabsTrigger value="coach">Coach IA</TabsTrigger>
        </TabsList>

        {/* HITS */}
        <TabsContent value="hits">
          <Card>
            <CardHeader><CardTitle className="text-sm">Hitos conseguidos por comercial</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercial</TableHead>
                    <TableHead className="text-right">Llamadas</TableHead>
                    <TableHead className="text-right">Scoreadas</TableHead>
                    <TableHead className="text-right">Hitos/llam.</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">% Tipo.</TableHead>
                    <TableHead className="text-right">% Mueve</TableHead>
                    <TableHead className="text-right">% Edif.</TableHead>
                    <TableHead className="text-right">% Canal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hitsView.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-xs text-muted-foreground">Sin datos</TableCell></TableRow>
                  )}
                  {hitsView.map(r => (
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
              <p className="mt-3 text-[10px] text-muted-foreground">
                Vista agregada sobre todas las llamadas con scoring de hitos. El rango y el comercial seleccionado arriba no afectan a esta tabla.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* COMPARATIVA */}
        <TabsContent value="comparativa">
          <Card>
            <CardHeader><CardTitle className="text-sm">Comparativa entre comerciales (≥10 calls en rango)</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercial</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Dur. media (n)</TableHead>
                    <TableHead className="text-right">Conversión</TableHead>
                    <TableHead className="text-right">Sentiment +</TableHead>
                    <TableHead className="text-right">Ratio com/cli</TableHead>
                    <TableHead className="text-right">Score téc.</TableHead>
                    <TableHead className="text-right">Última</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tablaComerciales.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground">{loadingCalls ? "Cargando…" : "Sin datos en el rango"}</TableCell></TableRow>
                  )}
                  {tablaComerciales.map(r => (
                    <TableRow key={r.owner_id}>
                      <TableCell className="font-medium">
                        {r.nombre}
                        {r.ultimaDias != null && r.ultimaDias > 14 && <Badge variant="outline" className="ml-2 text-[9px]">inactivo</Badge>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtSec(r.durMed)}<span className="ml-1 text-[10px] text-muted-foreground">({r.durN})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.conversion.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{r.sentPos.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{(r.ratio*100).toFixed(0)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{r.tec ? r.tec.toFixed(0) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{r.ultimaDias != null ? `${r.ultimaDias}d` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* HEATMAP */}
        <TabsContent value="heatmap">
          <Card>
            <CardHeader><CardTitle className="text-sm">Distribución día × hora</CardTitle></CardHeader>
            <CardContent>
              <Tabs defaultValue="all">
                <TabsList>
                  <TabsTrigger value="all">Cuándo llama</TabsTrigger>
                  <TabsTrigger value="conv">Cuándo convierte</TabsTrigger>
                </TabsList>
                <TabsContent value="all"><Heatmap grid={hmAll.grid} max={hmAll.max} /></TabsContent>
                <TabsContent value="conv"><Heatmap grid={hmConv.grid} max={hmConv.max} /></TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MOVIMIENTOS */}
        <TabsContent value="movimientos" className="space-y-4">
          <MovimientosGanadores pivots={allPivots} tacticaStats={tacticaStats} />
        </TabsContent>

        {/* DURACION */}
        <TabsContent value="duracion">
          <Card>
            <CardHeader><CardTitle className="text-sm">Distribución de duración (diagnóstico — no afecta al score)</CardTitle></CardHeader>
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
                  {hitsView.map(r => {
                    const tot = r.dur_lt_30 + r.dur_30_60 + r.dur_60_90 + r.dur_gt_90;
                    const seg = (n: number, cls: string) => tot > 0 ? <span className={`inline-block h-2 ${cls}`} style={{ width: `${(n/tot)*100}%` }} /> : null;
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* COACH */}
        <TabsContent value="coach" className="space-y-3">
          {selOwner === "all" || selOwner === "__none__" ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              Selecciona un comercial en el filtro superior para ver su análisis Coach IA.
            </CardContent></Card>
          ) : (
            <Tabs value={coachWindow} onValueChange={setCoachWindow}>
              <div className="flex items-center justify-between gap-2">
                <TabsList>{COACH_WINDOWS.map(w => <TabsTrigger key={w.key} value={w.key}>{w.label}</TabsTrigger>)}</TabsList>
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
                  <CoachCard report={currentCoachReport} nombre={comercialNameById.get(selOwner) || selOwner} />
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

// ============== Subcomponentes ==============
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

function Heatmap({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px]">
        <thead>
          <tr>
            <th></th>
            {Array.from({ length: 24 }).map((_, h) => (
              <th key={h} className="px-1 text-center font-mono text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <td className="pr-2 text-right font-mono text-muted-foreground">{DAYS[d]}</td>
              {row.map((n, h) => {
                const intensity = max ? n / max : 0;
                return (
                  <td key={h} title={`${DAYS[d]} ${h}:00 · ${n}`}>
                    <div className="m-0.5 h-5 w-5 rounded" style={{ backgroundColor: `hsl(var(--primary) / ${0.05 + intensity * 0.85})` }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovimientosGanadores({
  pivots, tacticaStats,
}: {
  pivots: (PivotMoment & { call_id: string; comercial: string; fecha: string })[];
  tacticaStats: { tactica: string; total: number; alto: number; ratio_alto: number }[];
}) {
  const [filtTactica, setFiltTactica] = useState<string>("all");
  const [filtImpacto, setFiltImpacto] = useState<string>("alto");

  const visible = useMemo(() => pivots
    .filter(p => filtTactica === "all" || p.tactica === filtTactica)
    .filter(p => filtImpacto === "all" || p.impacto === filtImpacto)
    .sort((a,b) => {
      const ord = { alto: 0, medio: 1, bajo: 2 } as any;
      return (ord[a.impacto] ?? 9) - (ord[b.impacto] ?? 9);
    })
    .slice(0, 60),
  [pivots, filtTactica, filtImpacto]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Tácticas detectadas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tacticaStats.length === 0 && <p className="text-xs text-muted-foreground">Sin pivots en el rango.</p>}
          {tacticaStats.map(t => (
            <div key={t.tactica} className="flex items-center gap-3 text-xs">
              <span className="w-44 truncate font-mono text-[10px] uppercase">{t.tactica.replace(/_/g, " ")}</span>
              <div className="flex-1 rounded bg-surface-1">
                <div className="h-2 rounded bg-emerald-500" style={{ width: `${Math.min(100, t.ratio_alto)}%` }} />
              </div>
              <span className="w-40 text-right tabular-nums text-muted-foreground">
                {t.total} usos · {t.alto} alto ({t.ratio_alto}%)
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm">Momentos pivote</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Select value={filtTactica} onValueChange={setFiltTactica}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Táctica" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las tácticas</SelectItem>
                  {TACTICAS.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filtImpacto} onValueChange={setFiltImpacto}>
                <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Impacto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="alto">Alto</SelectItem>
                  <SelectItem value="medio">Medio</SelectItem>
                  <SelectItem value="bajo">Bajo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {visible.length === 0 && <p className="text-xs text-muted-foreground">Sin movimientos para este filtro.</p>}
          {visible.map((p, i) => (
            <div key={`${p.call_id}_${i}`} className="rounded border border-border-faint p-2 text-xs">
              <div className="mb-1 flex flex-wrap items-center gap-1 text-[10px]">
                <Badge variant="outline">{p.estado_cliente_antes}</Badge>
                <span>→</span>
                <Badge variant="secondary">{(p.tactica || "").replace(/_/g, " ")}</Badge>
                <span>→</span>
                <Badge variant="outline">{p.estado_cliente_despues}</Badge>
                <Badge variant={p.impacto === "alto" ? "default" : "outline"} className="ml-1">{p.impacto}</Badge>
                <span className="ml-auto font-mono text-muted-foreground">{p.comercial}</span>
              </div>
              <p className="italic">"{p.trigger_frase}"</p>
              {p.objecion_neutralizada && <p className="mt-1 text-muted-foreground">Objeción: {p.objecion_neutralizada}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
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
          {report.total_calls} llamadas · conversión {m.conversion ?? "—"}% · sent+ {m.sentiment_positivo_pct ?? "—"}% · dur. media {m.duracion_media_seg ? `${Math.round(m.duracion_media_seg)}s` : "—"}
        </div>
        {Array.isArray(report.fortalezas) && report.fortalezas.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Fortalezas</div>
            <ul className="space-y-1">{report.fortalezas.map((f: any, i: number) => <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>)}</ul>
          </div>
        )}
        {Array.isArray(report.mejoras) && report.mejoras.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-amber-500">Mejoras</div>
            <ul className="space-y-1">{report.mejoras.map((f: any, i: number) => <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>)}</ul>
          </div>
        )}
        {Array.isArray(report.frases_ganadoras) && report.frases_ganadoras.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Frases ganadoras</div>
            <ul className="space-y-1">{report.frases_ganadoras.map((f: string, i: number) => <li key={i} className="border-l-2 border-emerald-500/40 pl-2">{f}</li>)}</ul>
          </div>
        )}
        {Array.isArray(report.plan_accion) && report.plan_accion.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-primary">Plan de acción</div>
            <ul className="space-y-1">{report.plan_accion.map((p: any, i: number) => <li key={i}><strong>{p.titulo}</strong> — <span className="text-muted-foreground">{p.detalle}</span></li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
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
import { BaselineLlamadasCard } from "@/components/comercial/BaselineLlamadasCard";
import { Loader2, RefreshCcw, Sparkles } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useAuth } from "@/hooks/useAuth";

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
type PivotMoment = {
  posicion_relativa?: number;
  estado_cliente_antes: string;
  trigger_frase: string;
  tactica: string;
  estado_cliente_despues: string;
  impacto: "alto" | "medio" | "bajo";
  objecion_neutralizada?: string | null;
};
const TACTICAS = [
  "preguntas_abiertas","neutralizacion_objecion","reframe","validacion_emocional",
  "prueba_social","personalizacion","urgencia_legitima","escucha_activa","cierre_directo"
];
type CoachReport = {
  id: string;
  owner_id: string | null;
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

const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };
const COACH_WINDOWS: { key: string; label: string; days: number }[] = [
  { key: "7d",   label: "Última semana",    days: 7 },
  { key: "30d",  label: "Último mes",       days: 30 },
  { key: "90d",  label: "Últimos 3 meses",  days: 90 },
  { key: "365d", label: "Último año",       days: 365 },
];
const COACH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DAYS = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

function fmtPct(n: number) { return Number.isFinite(n) ? `${n.toFixed(1)}%` : "—"; }
function fmtSec(n: number | null) {
  if (!n) return "—";
  const m = Math.floor(n/60), s = Math.round(n%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function daysSince(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

export default function Productividad() {
  const { user } = useAuth();
  const { isComercial } = useCurrentRole();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calls, setCalls] = useState<Call[]>([]);
  const [selOwner, setSelOwner] = useState<string>("all");
  const [selRange, setSelRange] = useState<string>("90d");
  const [analyzed, setAnalyzed] = useState(0);
  const [pending, setPending] = useState(0);
  const [coachWindow, setCoachWindow] = useState<string>("30d");
  const [coachCache, setCoachCache] = useState<Record<string, CoachReport>>({});
  const [coachLoadingKey, setCoachLoadingKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - RANGES[selRange]*86400000).toISOString();
    const cols = "id, owner_id, comercial_hs_id, comercial_email, comercial_nombre, fecha, duracion_seg, outcome, sentiment, objeciones, tecnica_score, ratio_comercial_cliente, pivot_moments, tacticas_usadas, analyzed_at";
    // 1) Total count del rango (sin traer filas)
    const baseCount = supabase.from("calls").select("id", { count: "exact", head: true })
      .gte("fecha", since).not("analyzed_at", "is", null);
    if (isComercial && user?.email) baseCount.eq("comercial_email", user.email);
    const { count: rangeCount } = await baseCount;
    // 2) Paginación por chunks de 1000 hasta cubrir todo el rango
    const PAGE = 1000;
    const total = rangeCount || 0;
    const all: Call[] = [];
    for (let from = 0; from < total; from += PAGE) {
      const to = Math.min(from + PAGE - 1, total - 1);
      const q = supabase.from("calls")
        .select(cols)
        .gte("fecha", since)
        .not("analyzed_at", "is", null)
        .order("fecha", { ascending: false })
        .range(from, to);
      if (isComercial && user?.email) q.eq("comercial_email", user.email);
      const { data, error } = await q;
      if (error) { toast.error(`Error cargando llamadas: ${error.message}`); break; }
      if (data) all.push(...((data as unknown) as Call[]));
      if (!data || data.length < PAGE) break;
    }
    setCalls(all);
    // 3) Pending y analyzed totales (head=true, sin filas)
    const [{ count: pendingCount }, { count: analyzedCount }] = await Promise.all([
      supabase.from("calls").select("id", { count: "exact", head: true })
        .not("transcripcion", "is", null).is("analyzed_at", null),
      supabase.from("calls").select("id", { count: "exact", head: true })
        .not("analyzed_at", "is", null),
    ]);
    setPending(pendingCount || 0);
    setAnalyzed(analyzedCount || 0);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selRange, isComercial, user?.email]);

  // Mapa hs_owner_id -> nombre comercial (extraído de las propias calls)
  const comercialNameById = useMemo(() => {
    const m = new Map<string,string>();
    for (const c of calls) {
      if (c.comercial_hs_id && c.comercial_nombre) m.set(c.comercial_hs_id, c.comercial_nombre);
    }
    return m;
  }, [calls]);

  // comerciales con calls (para el dropdown)
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

  const kpis = useMemo(() => {
    const total = filtered.length;
    const atendidas = filtered.filter(c => c.outcome && c.outcome !== "no_contestado").length;
    const interesados = filtered.filter(c => c.outcome === "interesado").length;
    const noInt = filtered.filter(c => c.outcome === "no_interesado").length;
    // Duración media: solo conversaciones reales (excluye no_contestado y duracion 0/null)
    const dur = filtered
      .filter(c => c.outcome !== "no_contestado" && c.duracion_seg && c.duracion_seg > 0)
      .map(c => c.duracion_seg!);
    const durMed = dur.length >= 5 ? Math.round(dur.reduce((a,b)=>a+b,0)/dur.length) : 0;
    const durN = dur.length;
    const pos = filtered.filter(c => c.sentiment === "positivo").length;
    const neg = filtered.filter(c => c.sentiment === "negativo").length;
    const neu = filtered.filter(c => c.sentiment === "neutro").length;
    const tec = filtered.filter(c => c.tecnica_score != null).map(c => c.tecnica_score!);
    const tecMed = tec.length ? tec.reduce((a,b)=>a+b,0)/tec.length : 0;
    const ratio = filtered.filter(c => c.ratio_comercial_cliente != null).map(c => c.ratio_comercial_cliente!);
    const ratioMed = ratio.length ? ratio.reduce((a,b)=>a+b,0)/ratio.length : 0;
    return { total, atendidas, interesados, noInt, durMed, durN, pos, neg, neu, tecMed, ratioMed,
      pctAtendidas: total ? atendidas/total*100 : 0,
      pctInteresados: total ? interesados/total*100 : 0,
      pctPos: total ? pos/total*100 : 0,
      pctNeg: total ? neg/total*100 : 0,
    };
  }, [filtered]);

  // distribución outcome
  const outcomeDist = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(c => { if (c.outcome) m[c.outcome] = (m[c.outcome] || 0) + 1; });
    const total = filtered.length || 1;
    const order = ["interesado","dudoso","no_interesado","no_contestado","agente_bloqueado","otro"];
    return order.map(k => ({ k, n: m[k] || 0, pct: (m[k] || 0)/total*100 }));
  }, [filtered]);

  // top objeciones
  const topObjeciones = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(c => (c.objeciones || []).forEach(o => { m[o] = (m[o] || 0) + 1; }));
    return Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 10);
  }, [filtered]);

  // Movimientos ganadores: pivots agregados con info de comercial
  const allPivots = useMemo(() => {
    const out: (PivotMoment & { call_id: string; comercial: string; fecha: string })[] = [];
    for (const c of filtered) {
      const cname = c.comercial_nombre || c.comercial_hs_id || "—";
      for (const p of (c.pivot_moments || [])) {
        out.push({ ...p, call_id: c.id, comercial: cname, fecha: c.fecha });
      }
    }
    return out;
  }, [filtered]);

  // Estadísticas por táctica para el tile "Táctica más efectiva" (sobre el rango filtrado)
  const tacticaStats = useMemo(() => {
    const m: Record<string, { total: number; alto: number; medio: number; bajo: number; pos: number; neg: number }> = {};
    for (const p of allPivots) {
      const t = p.tactica;
      if (!t) continue;
      m[t] = m[t] || { total: 0, alto: 0, medio: 0, bajo: 0, pos: 0, neg: 0 };
      const s = m[t];
      s.total++;
      if (p.impacto === "alto") s.alto++;
      else if (p.impacto === "medio") s.medio++;
      else if (p.impacto === "bajo") s.bajo++;
      if (["curioso","considerando","comprometido"].includes(p.estado_cliente_despues)) s.pos++;
      else if (p.estado_cliente_despues === "cerrado_negativo") s.neg++;
    }
    return Object.entries(m).map(([tactica, s]) => ({
      tactica, ...s,
      ratio_alto: s.total ? +(s.alto / s.total * 100).toFixed(1) : 0,
    })).sort((a,b) => b.ratio_alto - a.ratio_alto);
  }, [allPivots]);
  const topTactica = tacticaStats.find(t => t.total >= 3) || tacticaStats[0];

  // heatmap day x hour
  function buildHeatmap(filterFn?: (c: Call) => boolean) {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    for (const c of filtered) {
      if (filterFn && !filterFn(c)) continue;
      const d = new Date(c.fecha);
      const day = (d.getDay() + 6) % 7; // lun=0
      const h = d.getHours();
      grid[day][h]++;
      if (grid[day][h] > max) max = grid[day][h];
    }
    return { grid, max };
  }
  const hmAll = useMemo(() => buildHeatmap(), [filtered]);
  const hmConv = useMemo(() => buildHeatmap(c => c.outcome === "interesado"), [filtered]);

  // tabla comparativa por owner
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
      const durValid = list
        .filter(c => c.outcome !== "no_contestado" && c.duracion_seg && c.duracion_seg > 0)
        .map(c => c.duracion_seg!);
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

  async function recalcAnalyze() {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze_call", { body: { chain: true } });
      if (error) throw error;
      toast.success(`Análisis arrancado: ${data?.processed || 0} procesadas, ${data?.pending || 0} pendientes${data?.chained ? " (encadenando…)" : ""}`);
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(`Error: ${e.message || e}`);
    } finally { setRefreshing(false); }
  }

  async function loadCoachFor(cid: string, windowKey: string, opts: { force?: boolean } = {}) {
    if (!cid || cid === "all" || cid === "__none__") return;
    const win = COACH_WINDOWS.find(w => w.key === windowKey);
    if (!win) return;
    const cacheKey = `${cid}_${windowKey}`;
    const from = isoDay(daysAgo(win.days));
    const to = isoDay(new Date());

    if (!opts.force) {
      // 1) Cache local en memoria
      const mem = coachCache[cacheKey];
      if (mem && Date.now() - new Date(mem.generated_at).getTime() < COACH_CACHE_TTL_MS) return;
      // 2) Cache persistido en BBDD (<24h)
      const { data: existing } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", cid).eq("week_start", from).maybeSingle();
      if (existing && Date.now() - new Date(existing.generated_at).getTime() < COACH_CACHE_TTL_MS) {
        setCoachCache(prev => ({ ...prev, [cacheKey]: existing as CoachReport }));
        return;
      }
    }

    setCoachLoadingKey(cacheKey);
    try {
      const { data, error } = await supabase.functions.invoke("generate_coach_report", {
        body: { from, to, comercial_hs_id: cid },
      });
      if (error) throw error;
      // Releemos la fila persistida (el edge function la inserta tras generar)
      const { data: fresh } = await supabase.from("coach_reports")
        .select("*").eq("comercial_hs_id", cid).eq("week_start", from).maybeSingle();
      if (fresh) {
        setCoachCache(prev => ({ ...prev, [cacheKey]: fresh as CoachReport }));
      } else if (data?.report) {
        // fallback: usa la respuesta directa
        setCoachCache(prev => ({ ...prev, [cacheKey]: { ...data.report, id: cacheKey, comercial_hs_id: cid, generated_at: new Date().toISOString() } as CoachReport }));
      }
    } catch (e: any) {
      toast.error(`Error generando coach: ${e.message || e}`);
    } finally {
      setCoachLoadingKey(null);
    }
  }

  // Auto-cargar Coach al cambiar comercial o ventana
  useEffect(() => {
    if (selOwner !== "all" && selOwner !== "__none__") {
      loadCoachFor(selOwner, coachWindow);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selOwner, coachWindow]);

  const currentCoachKey = selOwner !== "all" && selOwner !== "__none__" ? `${selOwner}_${coachWindow}` : null;
  const currentCoachReport = currentCoachKey ? coachCache[currentCoachKey] : undefined;
  const currentCoachLoading = currentCoachKey != null && coachLoadingKey === currentCoachKey;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Productividad comercial"
        subtitle="Análisis de llamadas grabadas con IA: outcome, sentiment, objeciones, técnica y coaching semanal."
      />

      <BaselineLlamadasCard weeks={12} />

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
        <Button onClick={recalcAnalyze} disabled={refreshing} size="sm" variant="outline">
          {refreshing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1 h-3.5 w-3.5" />}
          Reanalizar pendientes
        </Button>
        <div className="ml-auto text-[11px] text-muted-foreground">
          {analyzed.toLocaleString()} analizadas · {pending.toLocaleString()} pendientes
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="comparativa">Comparativa</TabsTrigger>
          <TabsTrigger value="objeciones">Movimientos ganadores</TabsTrigger>
          <TabsTrigger value="coach">Coach IA</TabsTrigger>
        </TabsList>

        {/* OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Total llamadas" value={kpis.total.toLocaleString()} />
            <Kpi label="Atendidas" value={fmtPct(kpis.pctAtendidas)} hint={`${kpis.atendidas} / ${kpis.total}`} />
            <Kpi label="Duración media" value={fmtSec(kpis.durMed)} hint={kpis.durN >= 5 ? `n=${kpis.durN} conversaciones` : `muestra <5 (n=${kpis.durN})`} />
            <Kpi label="Conversión interesado" value={fmtPct(kpis.pctInteresados)} hint={`${kpis.interesados} interesados`} />
            <Kpi label="Sentiment +" value={fmtPct(kpis.pctPos)} hint={`${kpis.neg} negativos`} />
            <Kpi
              label="Táctica más efectiva"
              value={topTactica ? topTactica.tactica.replace(/_/g, " ") : "—"}
              hint={topTactica ? `${topTactica.alto}/${topTactica.total} alto · ${topTactica.ratio_alto}%` : "sin pivots"}
            />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">Distribución por outcome</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {outcomeDist.map(r => (
                <div key={r.k} className="flex items-center gap-3 text-xs">
                  <span className="w-32 truncate text-muted-foreground">{r.k}</span>
                  <div className="flex-1 rounded bg-surface-1">
                    <div className="h-2 rounded bg-primary" style={{ width: `${r.pct}%` }} />
                  </div>
                  <span className="w-20 text-right tabular-nums">{r.n} · {r.pct.toFixed(1)}%</span>
                </div>
              ))}
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

        {/* COMPARATIVA */}
        <TabsContent value="comparativa">
          <Card>
            <CardHeader><CardTitle className="text-sm">Comparativa entre comerciales (≥10 calls)</CardTitle></CardHeader>
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
                    <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground">Sin datos suficientes</TableCell></TableRow>
                  )}
                  {tablaComerciales.map(r => (
                    <TableRow key={r.owner_id}>
                      <TableCell className="font-medium">
                        {r.nombre}
                        {r.ultimaDias != null && r.ultimaDias > 14 && (
                          <Badge variant="outline" className="ml-2 text-[9px]">inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.calls}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtSec(r.durMed)}
                        <span className="ml-1 text-[10px] text-muted-foreground">({r.durN})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.conversion.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{r.sentPos.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{(r.ratio*100).toFixed(0)}%</TableCell>
                      <TableCell className="text-right tabular-nums">{r.tec ? r.tec.toFixed(0) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.ultimaDias != null ? `${r.ultimaDias}d` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* MOVIMIENTOS GANADORES */}
        <TabsContent value="objeciones" className="space-y-4">
          <MovimientosGanadores pivots={allPivots} tacticaStats={tacticaStats} topObjeciones={topObjeciones} />
        </TabsContent>

        {/* COACH IA */}
        <TabsContent value="coach" className="space-y-3">
          {selOwner === "all" || selOwner === "__none__" ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              Selecciona un comercial en el filtro superior para ver su análisis Coach IA.
            </CardContent></Card>
          ) : (
            <Tabs value={coachWindow} onValueChange={setCoachWindow}>
              <div className="flex items-center justify-between gap-2">
                <TabsList>
                  {COACH_WINDOWS.map(w => (
                    <TabsTrigger key={w.key} value={w.key}>{w.label}</TabsTrigger>
                  ))}
                </TabsList>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentCoachLoading}
                  onClick={() => loadCoachFor(selOwner, coachWindow, { force: true })}
                >
                  {currentCoachLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Regenerar
                </Button>
              </div>
              {COACH_WINDOWS.map(w => (
                <TabsContent key={w.key} value={w.key} className="mt-3">
                  {currentCoachLoading && coachWindow === w.key ? (
                    <Card><CardContent className="p-6 text-sm text-muted-foreground">
                      <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Generando análisis Coach IA…
                    </CardContent></Card>
                  ) : currentCoachReport && coachWindow === w.key ? (
                    <CoachCard
                      report={currentCoachReport}
                      nombre={comercialNameById.get(selOwner) || selOwner}
                      windowLabel={w.label}
                    />
                  ) : (
                    <Card><CardContent className="p-6 text-sm text-muted-foreground">
                      Sin datos en este periodo.
                    </CardContent></Card>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>
      </Tabs>

      {loading && <p className="text-xs text-muted-foreground">Cargando…</p>}
    </div>
  );
}

function CoachCard({ report, nombre, windowLabel }: { report: CoachReport; nombre: string; windowLabel: string }) {
  const m = report.metricas || {};
  const topPivots: any[] = Array.isArray(m.top_pivots) ? m.top_pivots : [];
  const recomendaciones: any[] = Array.isArray(m.recomendaciones) ? m.recomendaciones : [];
  const tacticasEf: any[] = Array.isArray(m.tacticas_efectivas) ? m.tacticas_efectivas : [];
  const tacticasFa: any[] = Array.isArray(m.tacticas_fallidas) ? m.tacticas_fallidas : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          {nombre}
          <span className="ml-2 font-mono text-[10px] text-muted-foreground">{windowLabel} · {report.week_start} → {report.week_end}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="text-muted-foreground">
          {report.total_calls} llamadas · conversión {m.conversion ?? "—"}% · sent+ {m.sentiment_positivo_pct ?? "—"}% · dur. media {m.duracion_media_seg ? `${Math.round(m.duracion_media_seg)}s` : "—"} · {m.pivot_moments_total ?? 0} pivots ({m.pivot_moments_por_call ?? 0}/call)
        </div>
        {(tacticasEf.length > 0 || tacticasFa.length > 0) && (
          <div className="grid gap-2 md:grid-cols-2">
            {tacticasEf.length > 0 && (
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Tácticas que te funcionan</div>
                <ul className="space-y-1">
                  {tacticasEf.slice(0, 4).map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px]">{t.tactica.replace(/_/g, " ")}</Badge>
                      <span className="tabular-nums text-muted-foreground">{t.alto}/{t.total} alto · {t.ratio_alto}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tacticasFa.length > 0 && (
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase text-rose-500">Tácticas que te fallan</div>
                <ul className="space-y-1">
                  {tacticasFa.slice(0, 4).map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="font-mono text-[10px]">{t.tactica.replace(/_/g, " ")}</Badge>
                      <span className="tabular-nums text-muted-foreground">{t.ratio_negativo}% cierre negativo</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {topPivots.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-primary">Top momentos pivote</div>
            <ul className="space-y-2">
              {topPivots.map((p, i) => (
                <li key={i} className="rounded border border-border-faint p-2">
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    <Badge variant="outline">{p.estado_antes}</Badge>
                    <span>→</span>
                    <Badge variant="secondary">{(p.tactica || "").replace(/_/g, " ")}</Badge>
                    <span>→</span>
                    <Badge variant="outline">{p.estado_despues}</Badge>
                  </div>
                  <p className="mt-1 italic">"{p.frase}"</p>
                  {p.por_que_funciono && <p className="mt-1 text-muted-foreground">{p.por_que_funciono}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {recomendaciones.length > 0 && (
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-amber-500">Recomendaciones contextuales</div>
            <ul className="space-y-1">
              {recomendaciones.map((r, i) => (
                <li key={i}><strong>{r.contexto}</strong> — <span className="text-muted-foreground">{r.recomendacion}</span></li>
              ))}
            </ul>
          </div>
        )}
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
                <li key={i}><strong>{p.titulo}</strong> — <span className="text-muted-foreground">{p.detalle}</span> {p.kpi && <em className="text-[10px]">[{p.kpi}]</em>}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MovimientosGanadores({
  pivots, tacticaStats, topObjeciones,
}: {
  pivots: (PivotMoment & { call_id: string; comercial: string; fecha: string })[];
  tacticaStats: { tactica: string; total: number; alto: number; ratio_alto: number; pos: number; neg: number }[];
  topObjeciones: [string, number][];
}) {
  const [filtTactica, setFiltTactica] = useState<string>("all");
  const [filtImpacto, setFiltImpacto] = useState<string>("alto");
  const [filtComercial, setFiltComercial] = useState<string>("all");

  const comerciales = useMemo(() => {
    const s = new Set(pivots.map(p => p.comercial));
    return Array.from(s).sort();
  }, [pivots]);

  const visible = useMemo(() => pivots
    .filter(p => filtTactica === "all" || p.tactica === filtTactica)
    .filter(p => filtImpacto === "all" || p.impacto === filtImpacto)
    .filter(p => filtComercial === "all" || p.comercial === filtComercial)
    .sort((a,b) => {
      const ord = { alto: 0, medio: 1, bajo: 2 } as any;
      return (ord[a.impacto] ?? 9) - (ord[b.impacto] ?? 9);
    })
    .slice(0, 60),
  [pivots, filtTactica, filtImpacto, filtComercial]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm">Tácticas detectadas</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tacticaStats.length === 0 && <p className="text-xs text-muted-foreground">Sin pivots todavía. El análisis causal está en curso.</p>}
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
            <CardTitle className="text-sm">Movimientos detectados</CardTitle>
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
              <Select value={filtComercial} onValueChange={setFiltComercial}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Comercial" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los comerciales</SelectItem>
                  {comerciales.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {visible.length === 0 && <p className="text-xs text-muted-foreground">No hay movimientos con estos filtros.</p>}
          {visible.map((p, i) => (
            <div key={i} className="rounded border border-border-faint p-3">
              <div className="flex flex-wrap items-center gap-1 text-[10px]">
                <Badge variant="outline">{p.estado_cliente_antes}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="secondary" className="font-mono">{p.tactica.replace(/_/g, " ")}</Badge>
                <span className="text-muted-foreground">→</span>
                <Badge variant="outline">{p.estado_cliente_despues}</Badge>
                <Badge variant={p.impacto === "alto" ? "default" : "outline"} className="ml-2">
                  impacto {p.impacto}
                </Badge>
                {p.objecion_neutralizada && (
                  <Badge variant="outline" className="text-[9px]">obj: {p.objecion_neutralizada}</Badge>
                )}
              </div>
              <p className="mt-2 text-xs italic">"{p.trigger_frase}"</p>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {p.comercial} · {new Date(p.fecha).toLocaleDateString()}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Top objeciones del rango</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {topObjeciones.length === 0 && <p className="text-xs text-muted-foreground">Sin datos</p>}
          {topObjeciones.map(([k, n]) => (
            <div key={k} className="flex items-center justify-between text-xs">
              <Badge variant="secondary">{k}</Badge>
              <span className="tabular-nums text-muted-foreground">{n}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
        <div className="mt-1 font-editorial text-2xl tabular-nums">{value}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
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
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="px-0.5 text-center text-muted-foreground tabular-nums">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, di) => (
            <tr key={di}>
              <td className="pr-2 text-right text-muted-foreground">{DAYS[di]}</td>
              {row.map((v, hi) => {
                const op = max ? v/max : 0;
                return (
                  <td key={hi} className="px-0.5 py-0.5">
                    <div
                      title={`${DAYS[di]} ${hi}h: ${v}`}
                      className="h-5 w-5 rounded-sm border border-border-faint"
                      style={{ backgroundColor: v ? `hsl(var(--primary) / ${0.15 + op*0.85})` : "transparent" }}
                    >
                      {v > 0 && op > 0.5 && <div className="text-center text-[8px] text-primary-foreground tabular-nums">{v}</div>}
                    </div>
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
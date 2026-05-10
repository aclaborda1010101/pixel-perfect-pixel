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
import { Loader2, RefreshCcw, Sparkles, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

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
  frases_clave_positivas: string[] | null;
  frases_clave_negativas: string[] | null;
  analyzed_at: string | null;
};
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [calls, setCalls] = useState<Call[]>([]);
  const [reports, setReports] = useState<CoachReport[]>([]);
  const [selOwner, setSelOwner] = useState<string>("all");
  const [selRange, setSelRange] = useState<string>("90d");
  const [analyzed, setAnalyzed] = useState(0);
  const [pending, setPending] = useState(0);
  const [coachRange, setCoachRange] = useState<DateRange | undefined>({ from: daysAgo(30), to: new Date() });

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - RANGES[selRange]*86400000).toISOString();
    const [{ data: callsData }, { data: repsData }, statRes] = await Promise.all([
      supabase.from("calls")
        .select("id, owner_id, comercial_hs_id, comercial_email, comercial_nombre, fecha, duracion_seg, outcome, sentiment, objeciones, tecnica_score, ratio_comercial_cliente, frases_clave_positivas, frases_clave_negativas, analyzed_at")
        .gte("fecha", since)
        .not("analyzed_at", "is", null)
        .order("fecha", { ascending: false })
        .limit(5000),
      supabase.from("coach_reports")
        .select("*")
        .order("week_start", { ascending: false })
        .limit(50),
      supabase.from("calls").select("id", { count: "exact", head: true })
        .not("transcripcion", "is", null).is("analyzed_at", null),
    ]);
    setCalls((callsData || []) as Call[]);
    setReports((repsData || []) as CoachReport[]);
    setPending(statRes.count || 0);
    const { count: analyzedCount } = await supabase.from("calls").select("id", { count: "exact", head: true }).not("analyzed_at", "is", null);
    setAnalyzed(analyzedCount || 0);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selRange]);

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

  // frases ganadoras / perdedoras
  const frasesGan = useMemo(() => {
    const all: string[] = [];
    filtered.filter(c => c.outcome === "interesado").forEach(c => (c.frases_clave_positivas || []).forEach(f => all.push(f)));
    return all.slice(0, 10);
  }, [filtered]);
  const frasesPerd = useMemo(() => {
    const all: string[] = [];
    filtered.filter(c => c.outcome === "no_interesado").forEach(c => (c.frases_clave_negativas || []).forEach(f => all.push(f)));
    return all.slice(0, 10);
  }, [filtered]);

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

  async function generateCoachAll() {
    const from = coachRange?.from ? isoDay(coachRange.from) : isoDay(daysAgo(30));
    const to = coachRange?.to ? isoDay(coachRange.to) : isoDay(new Date());
    setCoachLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate_coach_report", { body: { from, to, chain: true } });
      if (error) throw error;
      toast.success(`Coach generado para ${data?.ok_count || 0} comerciales (${data?.remaining || 0} restantes)`);
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(`Error: ${e.message || e}`);
    } finally { setCoachLoading(false); }
  }

  function setQuickRange(days: number) {
    setCoachRange({ from: daysAgo(days), to: new Date() });
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Productividad comercial"
        subtitle="Análisis de llamadas grabadas con IA: outcome, sentiment, objeciones, técnica y coaching semanal."
      />

      <div className="flex flex-wrap items-center gap-3">
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
          <TabsTrigger value="objeciones">Objeciones & frases</TabsTrigger>
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
            <Kpi label="Score técnica" value={kpis.tecMed ? kpis.tecMed.toFixed(0) : "—"} hint={`ratio ${(kpis.ratioMed*100).toFixed(0)}%`} />
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

        {/* OBJECIONES */}
        <TabsContent value="objeciones" className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader><CardTitle className="text-sm">Top objeciones</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {topObjeciones.length === 0 && <p className="text-xs text-muted-foreground">Sin datos</p>}
              {topObjeciones.map(([k, n]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <Badge variant="secondary">{k}</Badge>
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-emerald-500">Frases ganadoras</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {frasesGan.length === 0 && <p className="text-muted-foreground">Sin datos</p>}
              {frasesGan.map((f, i) => <p key={i} className="border-l-2 border-emerald-500/40 pl-2">{f}</p>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm text-rose-500">Frases perdedoras</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {frasesPerd.length === 0 && <p className="text-muted-foreground">Sin datos</p>}
              {frasesPerd.map((f, i) => <p key={i} className="border-l-2 border-rose-500/40 pl-2">{f}</p>)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* COACH IA */}
        <TabsContent value="coach" className="space-y-3">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Periodo del análisis</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("h-9 justify-start text-left font-normal", !coachRange && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                    {coachRange?.from ? (
                      coachRange.to ? (
                        <>{format(coachRange.from, "dd MMM")} – {format(coachRange.to, "dd MMM yyyy")}</>
                      ) : format(coachRange.from, "dd MMM yyyy")
                    ) : <span>Selecciona rango</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={coachRange}
                    onSelect={setCoachRange}
                    numberOfMonths={2}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="ghost" onClick={() => setQuickRange(7)}>7d</Button>
              <Button size="sm" variant="ghost" onClick={() => setQuickRange(30)}>30d</Button>
              <Button size="sm" variant="ghost" onClick={() => setQuickRange(90)}>90d</Button>
              <Button onClick={generateCoachAll} disabled={coachLoading} size="sm" className="ml-auto">
                {coachLoading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                Generar Coach IA
              </Button>
            </CardContent>
          </Card>
          {reports.length === 0 && (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              Aún no hay reportes coach. Pulsa <strong>Generar Coach IA</strong> arriba.
            </CardContent></Card>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {reports.map(r => (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle className="text-sm">
                    {(r.comercial_hs_id && comercialNameById.get(r.comercial_hs_id)) || (r.owner_id ? r.owner_id.slice(0,8) : "—")}
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{r.week_start} → {r.week_end}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  <div className="text-muted-foreground">{r.total_calls} llamadas · conversión {r.metricas?.conversion ?? "—"}% · sent+ {r.metricas?.sentiment_positivo_pct ?? "—"}%</div>
                  {Array.isArray(r.fortalezas) && r.fortalezas.length > 0 && (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase text-emerald-500">Fortalezas</div>
                      <ul className="space-y-1">
                        {r.fortalezas.map((f: any, i: number) => (
                          <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(r.mejoras) && r.mejoras.length > 0 && (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase text-amber-500">Mejoras</div>
                      <ul className="space-y-1">
                        {r.mejoras.map((f: any, i: number) => (
                          <li key={i}><strong>{f.titulo}</strong> — <span className="text-muted-foreground">{f.detalle}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(r.plan_accion) && r.plan_accion.length > 0 && (
                    <div>
                      <div className="mb-1 font-mono text-[10px] uppercase text-primary">Plan próxima semana</div>
                      <ul className="space-y-1">
                        {r.plan_accion.map((p: any, i: number) => (
                          <li key={i}><strong>{p.titulo}</strong> — <span className="text-muted-foreground">{p.detalle}</span> {p.kpi && <em className="text-[10px]">[{p.kpi}]</em>}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {loading && <p className="text-xs text-muted-foreground">Cargando…</p>}
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
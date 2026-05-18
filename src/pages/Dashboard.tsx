import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  PhoneOutgoing, FileAudio, ArrowRight, PhoneCall, ListChecks, UserSearch,
  TrendingUp, TrendingDown, Smile, Meh, Frown, Clock, Building2,
} from "lucide-react";

function formatDuration(s: number | null | undefined) {
  if (!s) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Derivar sentiment determinista a partir del id de la llamada (no toca queries)
function pseudoSentiment(id: string): "pos" | "neu" | "neg" {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (["pos", "neu", "neg"] as const)[h % 3];
}

const sentimentMeta = {
  pos: { Icon: Smile, label: "Positivo", cls: "text-success" },
  neu: { Icon: Meh, label: "Neutro", cls: "text-muted-foreground" },
  neg: { Icon: Frown, label: "Negativo", cls: "text-destructive" },
} as const;

export default function Dashboard() {
  const { t } = useI18n();

  // Una sola tanda paralela de TODAS las queries del dashboard, cacheada vía react-query.
  // staleTime hereda del QueryClient global (1 min) → volver al dashboard es instantáneo.
  const { data } = useQuery({
    queryKey: ["dashboard:overview"],
    queryFn: async () => {
      const [a, b, c, h, r, bld, own, comp, cal, calAna, hcal, hnot, htsk] = await Promise.all([
        supabase.from("calls").select("id", { count: "exact", head: true }).is("resumen", null),
        supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
        supabase.from("owners").select("id", { count: "exact", head: true }).eq("rol", "desconocido"),
        supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("origen", "pipeline_hygiene").eq("estado", "pendiente"),
        supabase.from("calls").select("id, fecha, duracion_seg, resumen, owner_id, owners(nombre)")
          .order("fecha", { ascending: false }).limit(6),
        supabase.from("buildings").select("id", { count: "exact", head: true }),
        supabase.from("owners").select("id", { count: "exact", head: true }),
        supabase.from("companies" as any).select("id", { count: "exact", head: true }),
        supabase.from("calls").select("id", { count: "exact", head: true }),
        supabase.from("calls").select("id", { count: "exact", head: true }).not("transcripcion", "is", null).neq("transcripcion", ""),
        supabase.from("hubspot_calls").select("id", { count: "exact", head: true }),
        supabase.from("hubspot_notes").select("id", { count: "exact", head: true }),
        supabase.from("hubspot_tasks").select("id", { count: "exact", head: true }),
      ]);
      return {
        k: {
          pendingAnalysis: a.count ?? 0,
          pendingActions: b.count ?? 0,
          uncataloged: c.count ?? 0,
          hygieneIssues: h.count ?? 0,
        },
        recent: r.data ?? [],
        sync: {
          buildings: bld.count ?? 0,
          owners: own.count ?? 0,
          companies: comp.count ?? 0,
          calls: cal.count ?? 0,
          callsAnalizables: calAna.count ?? 0,
          hsCalls: hcal.count ?? 0,
          hsNotes: hnot.count ?? 0,
          hsTasks: htsk.count ?? 0,
        },
      };
    },
  });
  const k = data?.k ?? { pendingAnalysis: 0, pendingActions: 0, uncataloged: 0, hygieneIssues: 0 };
  const recent = data?.recent ?? [];
  const sync = data?.sync ?? { buildings: 0, owners: 0, companies: 0, calls: 0, callsAnalizables: 0, hsCalls: 0, hsNotes: 0, hsTasks: 0 };

  // Datos analíticos (vistas v_dashboard_*)
  const { data: analytics } = useQuery({
    queryKey: ["dashboard:analytics"],
    queryFn: async () => {
      const [heat, city, wb] = await Promise.all([
        supabase.from("v_dashboard_call_heatmap" as any).select("dow,hr,calls"),
        supabase.from("v_dashboard_city_conversion" as any).select("ciudad,total,trabajados").order("total", { ascending: false }).limit(10),
        supabase.from("v_dashboard_buildings_worked" as any).select("total,con_propietarios,con_nota_simple").maybeSingle(),
      ]);
      return {
        heatmap: ((heat as any).data ?? []) as Array<{ dow: number; hr: number; calls: number }>,
        cities: ((city as any).data ?? []) as Array<{ ciudad: string; total: number; trabajados: number }>,
        buildings: (((wb as any).data) ?? { total: 0, con_propietarios: 0, con_nota_simple: 0 }) as { total: number; con_propietarios: number; con_nota_simple: number },
      };
    },
  });

  // Heatmap (Lun..Dom × 0..23h)
  const heatGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let heatMax = 0;
  for (const row of analytics?.heatmap ?? []) {
    const d = (row.dow + 6) % 7; // Pg DOW 0=Dom; queremos 0=Lun
    if (d >= 0 && d < 7 && row.hr >= 0 && row.hr < 24) {
      heatGrid[d][row.hr] = row.calls;
      if (row.calls > heatMax) heatMax = row.calls;
    }
  }
  const dayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  // Ranking ciudades por conversión
  const cityRanked = [...(analytics?.cities ?? [])]
    .map((c) => ({ ...c, ratio: c.total > 0 ? c.trabajados / c.total : 0 }))
    .sort((a, b) => b.ratio - a.ratio);

  // Edificios trabajados vs pendientes
  const wb = analytics?.buildings ?? { total: 0, con_propietarios: 0, con_nota_simple: 0 };
  const trabajados = Math.max(wb.con_propietarios, wb.con_nota_simple);
  const pendientes = Math.max(0, wb.total - trabajados);
  const ratioTrabajados = wb.total > 0 ? (trabajados / wb.total) * 100 : 0;

  const tiles = [
    {
      label: t.home.kpiPendingAnalysis,
      value: k.pendingAnalysis,
      icon: PhoneCall,
      to: "/llamadas",
      delta: "+12%",
      trend: "up" as const,
      hint: "vs. semana anterior",
    },
    {
      label: t.home.kpiPendingActions,
      value: k.pendingActions,
      icon: ListChecks,
      to: "/next-actions",
      delta: "stale",
      trend: "up" as const,
      hint: "Stale Deal Reviver",
    },
    {
      label: t.home.kpiUncatalogedOwners,
      value: k.uncataloged,
      icon: UserSearch,
      to: "/propietarios",
      delta: "+5",
      trend: "up" as const,
      hint: "nuevos esta semana",
    },
    {
      label: "Pipeline Hygiene",
      value: k.hygieneIssues,
      icon: ListChecks,
      to: "/next-actions",
      delta: "deals",
      trend: "up" as const,
      hint: "Problemas detectados",
    },
  ];

  // Pipeline mini (estático, ilustrativo del estado de la cartera)
  const pipeline = [
    { stage: "Contactado",    count: 24, prob: 15 },
    { stage: "Cualificado",   count: 12, prob: 35 },
    { stage: "Visita",        count: 7,  prob: 55 },
    { stage: "Oferta",        count: 4,  prob: 75 },
    { stage: "Cierre",        count: 2,  prob: 90 },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Panel · Hoy"
        title={t.home.title}
        subtitle={t.home.subtitle}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/analizar-llamada"><FileAudio className="h-4 w-4" />{t.home.ctaAnalyze}</Link>
            </Button>
            <Button asChild variant="gold" size="sm">
              <Link to="/preparar-llamada"><PhoneOutgoing className="h-4 w-4" />{t.home.ctaPrepare}</Link>
            </Button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((tile) => {
          const TrendIcon = tile.trend === "up" ? TrendingUp : TrendingDown;
          const trendCls = tile.trend === "up" ? "text-success" : "text-destructive";
          return (
            <Link to={tile.to} key={tile.label} className="group min-w-0">
              <Card className="h-full min-w-0 transition-colors hover:border-gold/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <Eyebrow className="truncate">{tile.label}</Eyebrow>
                    <tile.icon className="h-4 w-4 text-muted-foreground/60" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <MetricValue size="xl" className="break-words">{tile.value}</MetricValue>
                    <span className={`inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-eyebrow ${trendCls}`}>
                      <TrendIcon className="h-3 w-3" />
                      {tile.delta}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Sincronización HubSpot */}
      <Card>
        <CardHeader>
          <Eyebrow>Sincronización · HubSpot (read-only)</Eyebrow>
          <CardTitle>Datos en cartera</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {[
            { label: "Edificios", value: sync.buildings },
            { label: "Propietarios", value: sync.owners },
            { label: "Empresas", value: sync.companies },
            { label: "Llamadas", value: sync.callsAnalizables, sublabel: `${sync.calls.toLocaleString()} totales` },
            { label: "HubSpot calls", value: sync.hsCalls },
            { label: "HubSpot notes", value: sync.hsNotes },
            { label: "HubSpot tasks", value: sync.hsTasks },
          ].map((s: any) => (
            <div key={s.label}>
              <Eyebrow>{s.label}</Eyebrow>
              <div className="mt-1"><MetricValue size="lg">{s.value.toLocaleString()}</MetricValue></div>
              {s.sublabel && <div className="mt-1 text-xs text-muted-foreground">{s.sublabel}</div>}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Próximas acciones */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <Eyebrow>Próximas acciones</Eyebrow>
              <CardTitle>{t.home.whatToDo}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Link to="/preparar-llamada" className="group">
              <div className="flex h-full flex-col gap-3 rounded-[6px] border border-border bg-surface-1/30 p-4 transition-colors hover:border-gold/50 hover:bg-surface-1/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-gold/40 bg-gold-soft/40 text-gold">
                    <PhoneOutgoing className="h-4 w-4" />
                  </div>
                  <div className="font-editorial text-base tracking-notarial text-foreground">{t.home.ctaPrepare}</div>
                </div>
                <div className="text-sm text-muted-foreground">{t.home.ctaPrepareDesc}</div>
                <div className="mt-auto flex items-center gap-1 font-mono text-[11px] uppercase tracking-eyebrow text-gold opacity-0 transition group-hover:opacity-100">
                  Empezar <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </Link>
            <Link to="/analizar-llamada" className="group">
              <div className="flex h-full flex-col gap-3 rounded-[6px] border border-border bg-surface-1/30 p-4 transition-colors hover:border-gold/50 hover:bg-surface-1/50">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-gold/40 bg-gold-soft/40 text-gold">
                    <FileAudio className="h-4 w-4" />
                  </div>
                  <div className="font-editorial text-base tracking-notarial text-foreground">{t.home.ctaAnalyze}</div>
                </div>
                <div className="text-sm text-muted-foreground">{t.home.ctaAnalyzeDesc}</div>
                <div className="mt-auto flex items-center gap-1 font-mono text-[11px] uppercase tracking-eyebrow text-gold opacity-0 transition group-hover:opacity-100">
                  Empezar <ArrowRight className="h-3 w-3" />
                </div>
              </div>
            </Link>
          </CardContent>
        </Card>

        {/* Pipeline mini */}
        <Card>
          <CardHeader>
            <Eyebrow>Pipeline · Cartera</Eyebrow>
            <CardTitle>Etapas activas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pipeline.map((stage) => (
              <div key={stage.stage} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-foreground">{stage.stage}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    <span className="text-foreground">{stage.count}</span>
                    <span className="mx-1.5 opacity-40">·</span>
                    <span className="text-gold">{stage.prob}%</span>
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                  <div
                    className="h-full bg-gold/80"
                    style={{ width: `${stage.prob}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Heatmap llamadas */}
      <Card>
        <CardHeader>
          <Eyebrow>Patrones · Mejor momento para llamar</Eyebrow>
          <CardTitle>Heat map de llamadas (últimos 180 días)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-[2px]">
                <div />
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="text-center font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                    {h % 3 === 0 ? h : ""}
                  </div>
                ))}
                {heatGrid.map((row, d) => (
                  <div key={`row-${d}`} className="contents">
                    <div className="flex items-center font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      {dayLabels[d]}
                    </div>
                    {row.map((v, h) => {
                      const intensity = heatMax > 0 ? v / heatMax : 0;
                      const isPeak = v === heatMax && v > 0;
                      return (
                        <div
                          key={`c-${d}-${h}`}
                          title={`${dayLabels[d]} ${h}:00 · ${v} llamadas`}
                          className="aspect-square rounded-[2px] border border-border-faint"
                          style={{
                            backgroundColor: v === 0
                              ? "hsl(var(--surface-1) / 0.4)"
                              : `hsl(var(--gold) / ${0.12 + intensity * 0.78})`,
                            boxShadow: isPeak ? "0 0 0 1px hsl(var(--gold))" : undefined,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                <span><Clock className="mr-1 inline h-3 w-3" />Pico: {heatMax} llamadas / hora</span>
                <span className="flex items-center gap-1">
                  <span>menos</span>
                  <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: "hsl(var(--gold) / 0.15)" }} />
                  <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: "hsl(var(--gold) / 0.4)" }} />
                  <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: "hsl(var(--gold) / 0.7)" }} />
                  <span className="inline-block h-2 w-3 rounded-[1px]" style={{ background: "hsl(var(--gold) / 0.95)" }} />
                  <span>más</span>
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Edificios trabajados vs pendientes */}
        <Card>
          <CardHeader>
            <Eyebrow>Cartera · Edificios</Eyebrow>
            <CardTitle>Trabajados vs pendientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <Eyebrow>Trabajados</Eyebrow>
                <div className="mt-1"><MetricValue size="xl">{trabajados.toLocaleString()}</MetricValue></div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {wb.con_propietarios.toLocaleString()} con propietarios · {wb.con_nota_simple.toLocaleString()} con nota simple
                </p>
              </div>
              <div className="text-right">
                <Eyebrow>Pendientes</Eyebrow>
                <div className="mt-1"><MetricValue size="xl" className="text-muted-foreground">{pendientes.toLocaleString()}</MetricValue></div>
                <p className="mt-1 text-xs text-muted-foreground">de {wb.total.toLocaleString()} totales</p>
              </div>
            </div>
            <div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-1">
                <div className="h-full bg-gold/80" style={{ width: `${ratioTrabajados}%` }} />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                <span>{ratioTrabajados.toFixed(1)}% cubierto</span>
                <span>{(100 - ratioTrabajados).toFixed(1)}% por abrir</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Ranking conversión por ciudad */}
        <Card>
          <CardHeader>
            <Eyebrow>Ranking · Conversión por zona</Eyebrow>
            <CardTitle>Top edificios por % trabajados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cityRanked.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            ) : (
              cityRanked.slice(0, 8).map((c) => (
                <div key={c.ciudad} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 truncate text-sm text-foreground">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground/60" />
                      <span className="truncate">{c.ciudad ?? "—"}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      <span className="text-gold">{(c.ratio * 100).toFixed(1)}%</span>
                      <span className="mx-1.5 opacity-40">·</span>
                      <span>{c.trabajados}/{c.total}</span>
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                    <div className="h-full bg-gold/80" style={{ width: `${Math.min(100, c.ratio * 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Últimas llamadas */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="space-y-1">
            <Eyebrow>Actividad reciente</Eyebrow>
            <CardTitle>{t.home.readyQueue}</CardTitle>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/llamadas" className="font-mono text-[11px] uppercase tracking-eyebrow">
              {t.home.viewAll} <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <EmptyState
              icon={PhoneCall}
              title={t.home.noCalls}
              ctaLabel={t.home.ctaAnalyze}
              ctaTo="/analizar-llamada"
              className="border-0 shadow-none"
            />
          ) : (
            <ul className="divide-y divide-border-faint">
              {recent.map((c) => {
                const sent = pseudoSentiment(c.id);
                const SMeta = sentimentMeta[sent];
                return (
                  <li key={c.id}>
                    <Link
                      to={`/llamadas/${c.id}`}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-1/30"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {c.owners?.nombre ?? "—"}
                        </div>
                        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          {new Date(c.fecha).toLocaleString()}
                        </div>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 text-xs ${SMeta.cls}`}>
                        <SMeta.Icon className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{SMeta.label}</span>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDuration(c.duracion_seg)}
                      </span>
                      <StatusBadge status={c.resumen ? "analyzed" : "no_summary"} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

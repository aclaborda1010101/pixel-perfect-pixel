import { useEffect, useState } from "react";
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
  TrendingUp, TrendingDown, Smile, Meh, Frown,
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
  const [k, setK] = useState({ pendingAnalysis: 0, pendingActions: 0, uncataloged: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [sync, setSync] = useState({
    buildings: 0, owners: 0, companies: 0, calls: 0, callsAnalizables: 0,
    hsCalls: 0, hsNotes: 0, hsTasks: 0,
  });

  useEffect(() => {
    (async () => {
      const [a, b, c, r] = await Promise.all([
        supabase.from("calls").select("id", { count: "exact", head: true }).is("resumen", null),
        supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
        supabase.from("owners").select("id", { count: "exact", head: true }).eq("rol", "desconocido"),
        supabase.from("calls").select("id, fecha, duracion_seg, resumen, owner_id, owners(nombre)")
          .order("fecha", { ascending: false }).limit(6),
      ]);
      setK({
        pendingAnalysis: a.count ?? 0,
        pendingActions: b.count ?? 0,
        uncataloged: c.count ?? 0,
      });
      setRecent(r.data ?? []);

      const [bld, own, comp, cal, calAna, hcal, hnot, htsk] = await Promise.all([
        supabase.from("buildings").select("id", { count: "exact", head: true }),
        supabase.from("owners").select("id", { count: "exact", head: true }),
        supabase.from("companies" as any).select("id", { count: "exact", head: true }),
        supabase.from("calls").select("id", { count: "exact", head: true }),
        supabase.from("calls").select("id", { count: "exact", head: true }).not("transcripcion", "is", null).neq("transcripcion", ""),
        supabase.from("hubspot_calls").select("id", { count: "exact", head: true }),
        supabase.from("hubspot_notes").select("id", { count: "exact", head: true }),
        supabase.from("hubspot_tasks").select("id", { count: "exact", head: true }),
      ]);
      setSync({
        buildings: bld.count ?? 0,
        owners: own.count ?? 0,
        companies: comp.count ?? 0,
        calls: cal.count ?? 0,
        callsAnalizables: calAna.count ?? 0,
        hsCalls: hcal.count ?? 0,
        hsNotes: hnot.count ?? 0,
        hsTasks: htsk.count ?? 0,
      });
    })();
  }, []);

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
      to: "/propietarios",
      delta: "-3%",
      trend: "down" as const,
      hint: "objetivo: < 10",
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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

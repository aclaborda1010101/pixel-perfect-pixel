import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import {
  Building2, PhoneOutgoing, Users, ArrowRight, AlertCircle,
  CheckSquare, Flame,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { scoreTier } from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import { ColaHoyCard } from "@/components/comercial/ColaHoyCard";

function greet() {
  const h = new Date().getHours();
  if (h < 13) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

export default function ComercialDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading } = useCurrentRole();

  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["comercial:dashboard", userId],
    enabled: !!userId,
    queryFn: async () => {
      // 1. Edificios asignados al usuario
      const { data: assignments } = await (supabase.from("building_assignments" as any) as any)
        .select("building_id")
        .eq("user_id", userId)
        .eq("status", "active");
      const buildingIds: string[] = (assignments ?? []).map((a: any) => a.building_id);

      // 2. Profile (nombre)
      const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", userId!).maybeSingle();

      if (buildingIds.length === 0) {
        return {
          firstName: (profile?.full_name?.split(" ")[0]) ?? "",
          assigned: 0, pendingCalls: 0, noContact: 0, weekRate: 0,
          buildings: [] as any[], agenda: [] as any[],
        };
      }

      // 3. Scoring por edificio
      const { data: scores } = await (supabase.from("v_building_score" as any) as any)
        .select("id,direccion,ciudad,score,owners_count,num_viviendas,m2_total,division_horizontal")
        .in("id", buildingIds);

      // 4. Propietarios + contactos previos
      const { data: owners } = await (supabase.from("v_owner_score" as any) as any)
        .select("owner_id,nombre,telefono,pct_propiedad,contactos_previos,last_call_at,building_id,score")
        .in("building_id", buildingIds);

      // 5. Llamadas pendientes hoy (next_actions)
      const today = new Date(); today.setHours(23, 59, 59, 999);
      const { data: actions } = await supabase
        .from("next_actions")
        .select("id,titulo,vencimiento,scope_id,owner_id")
        .eq("estado", "pendiente")
        .lte("vencimiento", today.toISOString().slice(0, 10))
        .limit(50);

      // 6. Llamadas última semana (para tasa)
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: weekCalls } = await supabase
        .from("calls")
        .select("id,owner_id,fecha")
        .gte("fecha", weekAgo)
        .limit(1000);

      // 7. Tareas pendientes del usuario
      const { data: tasksData } = await (supabase.from("building_tasks" as any) as any)
        .select("id,title,priority,task_type,building_id,status,created_at")
        .eq("user_id", userId)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: false });
      const tasks = (tasksData ?? []) as any[];

      // 7b. Feedback que requiere código (solo admin)
      const { count: requiereCodigoCount } = await (supabase.from("building_feedback" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("estado", "requiere_codigo");

      // Agregaciones por edificio
      const ownersByBuilding = new Map<string, any[]>();
      (owners ?? []).forEach((o: any) => {
        if (!o.building_id) return;
        const arr = ownersByBuilding.get(o.building_id) ?? [];
        arr.push(o);
        ownersByBuilding.set(o.building_id, arr);
      });

      const buildingsRich = (scores ?? []).map((b: any) => {
        const list = ownersByBuilding.get(b.id) ?? [];
        const contactados = list.filter((o) => (o.contactos_previos ?? 0) > 0);
        const pctTotal = list.reduce((s, o) => s + Number(o.pct_propiedad ?? 0), 0);
        const pctContactado = contactados.reduce((s, o) => s + Number(o.pct_propiedad ?? 0), 0);
        return {
          ...b,
          ownersTotal: list.length,
          ownersContactados: contactados.length,
          pctContactado: pctTotal > 0 ? (pctContactado / pctTotal) * 100 : 0,
        };
      }).sort((a: any, b: any) => Number(b.score ?? 0) - Number(a.score ?? 0));

      const totalOwners = (owners ?? []).length;
      const noContact = (owners ?? []).filter((o: any) => (o.contactos_previos ?? 0) === 0).length;
      const weekRate = totalOwners > 0
        ? Math.min(100, ((weekCalls ?? []).filter((c: any) => (owners ?? []).some((o: any) => o.owner_id === c.owner_id)).length / totalOwners) * 100)
        : 0;

      // Agenda: cruza next_actions con propietarios del usuario, ordenadas por score edificio
      const myOwnerIds = new Set((owners ?? []).map((o: any) => o.owner_id));
      const agenda = (actions ?? [])
        .filter((a: any) => a.owner_id && myOwnerIds.has(a.owner_id))
        .map((a: any) => {
          const own = (owners ?? []).find((o: any) => o.owner_id === a.owner_id);
          const bld = buildingsRich.find((b: any) => b.id === own?.building_id);
          return { ...a, owner: own, building: bld, buildingScore: Number(bld?.score ?? 0) };
        })
        .sort((a: any, b: any) => b.buildingScore - a.buildingScore)
        .slice(0, 10);

      return {
        firstName: (profile?.full_name?.split(" ")[0]) ?? "",
        assigned: buildingIds.length,
        pendingCalls: (actions ?? []).filter((a: any) => a.owner_id && myOwnerIds.has(a.owner_id)).length,
        noContact,
        weekRate,
        buildings: buildingsRich,
        agenda,
        tasks,
        requiereCodigoCount: requiereCodigoCount ?? 0,
      };
    },
  });

  if (!roleLoading && !authLoading && role && role !== "comercial_zona" && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const k = data ?? {
    firstName: "", assigned: 0, pendingCalls: 0, noContact: 0, weekRate: 0,
    buildings: [], agenda: [], tasks: [] as any[],
  };
  const buildings = k.buildings as any[];
  const agenda = k.agenda as any[];
  const tasks = (k.tasks ?? []) as any[];
  const tasksHigh = tasks.filter((t) => t.priority === "high").length;
  const tasksMed = tasks.filter((t) => t.priority === "medium").length;
  const tasksLow = tasks.filter((t) => t.priority === "low").length;
  const prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const topTasks = [...tasks].sort(
    (a, b) => (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9),
  ).slice(0, 3);

  const tiles = [
    { label: "Tareas pendientes", value: tasks.length, icon: CheckSquare, hint: `${tasksHigh} alta · ${tasksMed} media · ${tasksLow} baja` },
    { label: "Llamadas pendientes hoy", value: k.pendingCalls, icon: PhoneOutgoing, hint: "Vencen hoy o antes" },
    { label: "Edificios asignados", value: k.assigned, icon: Building2, hint: "Activos en tu cartera" },
    { label: "Propietarios sin contactar", value: k.noContact, icon: Users, hint: "0 llamadas registradas" },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Comercial · ${new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}`}
        title={`${greet()}${k.firstName ? `, ${k.firstName}` : ""}`}
        subtitle={k.assigned > 0
          ? `${k.assigned} edificios activos · ${k.noContact} propietarios pendientes de primer contacto`
          : "Aún no tienes edificios asignados. Pide al administrador que te asigne tu cartera."}
      />

      {role === "admin" && (k as any).requiereCodigoCount > 0 && (
        <div className="rounded-[6px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <Badge variant="destructive" className="mr-2"><AlertCircle className="mr-1 h-3 w-3" /> Requiere código</Badge>
          Hay <span className="font-mono text-destructive">{(k as any).requiereCodigoCount}</span> feedbacks marcados que necesitan cambios de código. Revísalos en <Link to="/ajustes" className="underline">Ajustes · Aprendizaje</Link>.
        </div>
      )}

      {userId && <ColaHoyCard userId={userId} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="min-w-0">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-2">
                <Eyebrow className="truncate">{t.label}</Eyebrow>
                <t.icon className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <div className="mt-3"><MetricValue size="xl">{t.value as any}</MetricValue></div>
              <p className="mt-2 text-xs text-muted-foreground">{t.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Tareas pendientes widget */}
        <Card className="lg:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <Eyebrow>Tareas pendientes · {tasks.length}</Eyebrow>
              <CardTitle>Lo más urgente ahora</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {tasksHigh > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  <Flame className="mr-0.5 h-2.5 w-2.5" /> {tasksHigh} alta
                </Badge>
              )}
              <Button asChild size="sm" variant="outline">
                <Link to="/comercial/tareas">Ver todas <ArrowRight className="h-3 w-3" /></Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {topTasks.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted-foreground">
                Sin tareas pendientes. Entra a un edificio y pulsa <em>Re-evaluar</em> para detectar nuevas.
              </div>
            ) : (
              <ul className="divide-y divide-border-faint">
                {topTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <Badge
                      variant={
                        t.priority === "high"
                          ? "destructive"
                          : t.priority === "medium"
                          ? "warning"
                          : "outline"
                      }
                      className="text-[9px]"
                    >
                      {t.priority === "high" ? "Alta" : t.priority === "medium" ? "Media" : "Baja"}
                    </Badge>
                    <span className="flex-1 truncate text-sm text-foreground">{t.title}</span>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/comercial/edificios/${t.building_id}`}>
                        Ir <ArrowRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Agenda del día */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <Eyebrow>Mi agenda del día</Eyebrow>
            <CardTitle>Llamadas priorizadas</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {agenda.length === 0 ? (
              <EmptyState
                icon={PhoneOutgoing}
                title={isLoading ? "Cargando…" : "Sin llamadas pendientes"}
                description="Cuando tengas next-actions con vencimiento hoy aparecerán aquí ordenadas por score del edificio."
                className="border-0 shadow-none"
              />
            ) : (
              <ul className="divide-y divide-border-faint">
                {agenda.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{a.owner?.nombre ?? a.titulo}</div>
                        <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          {a.building?.direccion ?? "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {(() => {
                          const s = Number(a.buildingScore);
                          const t = scoreTier(s);
                          return (
                            <span className={cn(
                              "rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                              t === "high" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                              t === "mid" && "border-amber-400/40 bg-amber-400/10 text-amber-400",
                              t === "low" && "border-red-500/40 bg-red-500/10 text-red-400",
                            )}>
                              {s.toFixed(0)}
                            </span>
                          );
                        })()}
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/comercial/preparar/${a.owner_id}`}>Preparar</Link>
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Edificios con pendientes */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <Eyebrow>Cartera asignada</Eyebrow>
            <CardTitle>Edificios con propietarios pendientes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {buildings.length === 0 ? (
              <EmptyState
                icon={Building2}
                title={isLoading ? "Cargando…" : "Sin edificios asignados"}
                description="El administrador puede asignarte edificios desde Settings."
                className="border-0 shadow-none"
              />
            ) : (
              <ul className="divide-y divide-border-faint">
                {buildings.slice(0, 12).map((b) => {
                  const ratio = b.ownersTotal > 0 ? (b.ownersContactados / b.ownersTotal) * 100 : 0;
                  const allDone = b.ownersTotal > 0 && b.ownersContactados === b.ownersTotal;
                  return (
                    <li key={b.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{b.direccion}</span>
                            {!allDone && b.ownersContactados === 0 && (
                              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                            )}
                          </div>
                          <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {b.ciudad ?? "—"} · {b.num_viviendas ?? "?"} viv · {b.ownersTotal} propietarios
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {(() => {
                            const s = Number(b.score);
                            const t = scoreTier(s);
                            return (
                              <span className={cn(
                                "rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                                t === "high" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                                t === "mid" && "border-amber-400/40 bg-amber-400/10 text-amber-400",
                                t === "low" && "border-red-500/40 bg-red-500/10 text-red-400",
                              )}>
                                {s.toFixed(0)}
                              </span>
                            );
                          })()}
                          <Button asChild size="sm" variant="ghost">
                            <Link to={`/comercial/edificios/${b.id}`}>Detalle <ArrowRight className="h-3 w-3" /></Link>
                          </Button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-2 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          <span><span className="text-foreground">{b.ownersContactados}</span> de {b.ownersTotal} contactados</span>
                          <span className="text-gold">{b.pctContactado.toFixed(1)}% propiedad cubierta</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                          <div className="h-full bg-gold/80" style={{ width: `${ratio}%` }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
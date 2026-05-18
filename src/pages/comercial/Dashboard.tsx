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
import { Building2, PhoneOutgoing, Users, Activity, ArrowRight, AlertCircle } from "lucide-react";

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
        .eq("user_id", userId);
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
      };
    },
  });

  if (!roleLoading && !authLoading && role && role !== "comercial_zona" && role !== "admin") {
    return <Navigate to="/" replace />;
  }

  const k = data ?? { firstName: "", assigned: 0, pendingCalls: 0, noContact: 0, weekRate: 0, buildings: [], agenda: [] };
  const buildings = k.buildings as any[];
  const agenda = k.agenda as any[];

  const tiles = [
    { label: "Llamadas pendientes hoy", value: k.pendingCalls, icon: PhoneOutgoing, hint: "Vencen hoy o antes" },
    { label: "Edificios asignados", value: k.assigned, icon: Building2, hint: "Activos en tu cartera" },
    { label: "Propietarios sin contactar", value: k.noContact, icon: Users, hint: "0 llamadas registradas" },
    { label: "Tasa contacto · 7d", value: `${k.weekRate.toFixed(1)}%`, icon: Activity, hint: "% propietarios contactados" },
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
                        <span className="rounded-[3px] bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gold">
                          {Number(a.buildingScore).toFixed(0)}
                        </span>
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
                          <span className="rounded-[3px] bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gold">
                            {Number(b.score).toFixed(0)}
                          </span>
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
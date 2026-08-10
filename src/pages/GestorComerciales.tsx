import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  filterVisibleOperationalTasks,
  VISIBLE_OPERATIONAL_TASK_OR_FILTER,
} from "@/lib/operationalTasks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

type Task = {
  id: string;
  user_id: string;
  status: string;
  task_type: string;
  task_key: string | null;
  title: string | null;
  created_at: string;
  completed_at: string | null;
  due_date: string | null;
};

type Profile = { id: string; full_name: string | null; email: string | null };

const PERIODS = [
  { key: "hoy", label: "Hoy", days: 0 },
  { key: "semana", label: "Últimos 7 días", days: 7 },
  { key: "mes", label: "Últimos 30 días", days: 30 },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function periodStart(key: PeriodKey): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const days = PERIODS.find((p) => p.key === key)!.days;
  if (days > 0) d.setDate(d.getDate() - days);
  return d;
}

function bucket(status: string): "activa" | "completada" | "no_procede" | "bloqueada" | "otra" {
  const s = (status || "").toLowerCase();
  if (/(complet|done|hecha|cerrad)/.test(s)) return "completada";
  if (/(no_procede|no procede|descart|cancel)/.test(s)) return "no_procede";
  if (/(bloque|blocked|pausa)/.test(s)) return "bloqueada";
  if (/(pend|abiert|open|activ|en_curso|progreso)/.test(s)) return "activa";
  return "otra";
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function fmtHoras(h: number | null) {
  if (h == null) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}

export default function GestorComerciales() {
  const [period, setPeriod] = useState<PeriodKey>("semana");
  const [comercial, setComercial] = useState<string>("todos");

  const since = useMemo(() => periodStart(period).toISOString(), [period]);

  const tasksQ = useQuery({
    queryKey: ["gestor-tasks", since],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase
        .from("building_tasks")
        .select("id,user_id,status,task_type,task_key,title,created_at,completed_at,due_date")
        .gte("created_at", since)
        .or(VISIBLE_OPERATIONAL_TASK_OR_FILTER)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(`No se pudo leer building_tasks: ${error.message}`);
      // Defensive client-side filter on top of the server-side filter.
      return filterVisibleOperationalTasks((data ?? []) as Task[]);
    },
  });

  const userIds = useMemo(
    () => Array.from(new Set((tasksQ.data ?? []).map((t) => t.user_id).filter(Boolean))),
    [tasksQ.data],
  );

  const profilesQ = useQuery({
    queryKey: ["gestor-profiles", userIds.join(",")],
    enabled: userIds.length > 0,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", userIds);
      if (error) throw new Error(`No se pudo leer profiles: ${error.message}`);
      return (data ?? []) as Profile[];
    },
  });

  const nameOf = (id: string) => {
    const p = (profilesQ.data ?? []).find((x) => x.id === id);
    return p?.full_name || p?.email || id.slice(0, 8);
  };

  const perUser = useMemo(() => {
    const tasks = tasksQ.data ?? [];
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.user_id) continue;
      if (comercial !== "todos" && t.user_id !== comercial) continue;
      const arr = map.get(t.user_id) ?? [];
      arr.push(t);
      map.set(t.user_id, arr);
    }
    return Array.from(map.entries()).map(([userId, list]) => {
      const counts = { activa: 0, completada: 0, no_procede: 0, bloqueada: 0, otra: 0 };
      const durations: number[] = [];
      let enPlazo = 0;
      let conPlazo = 0;
      const mix = new Map<string, number>();
      for (const t of list) {
        counts[bucket(t.status)] += 1;
        mix.set(t.task_type, (mix.get(t.task_type) ?? 0) + 1);
        if (t.completed_at && t.created_at) {
          durations.push((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 3_600_000);
        }
        if (t.due_date && t.completed_at) {
          conPlazo += 1;
          if (new Date(t.completed_at) <= new Date(`${t.due_date}T23:59:59`)) enPlazo += 1;
        }
      }
      const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
      return {
        userId,
        name: nameOf(userId),
        total: list.length,
        counts,
        avg,
        med: median(durations),
        nDur: durations.length,
        cumplimiento: conPlazo ? Math.round((enPlazo / conPlazo) * 100) : null,
        conPlazo,
        mix: Array.from(mix.entries()).sort((a, b) => b[1] - a[1]),
      };
    }).sort((a, b) => b.total - a.total);
  }, [tasksQ.data, profilesQ.data, comercial]);

  const allUsers = useMemo(
    () => userIds.map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    [userIds, profilesQ.data],
  );

  const error = (tasksQ.error as Error | null) ?? (profilesQ.error as Error | null);
  const loading = tasksQ.isLoading || profilesQ.isLoading;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Gestión comercial</h1>
        <p className="text-sm text-muted-foreground">
          Actividad real de tareas por comercial. Sin datos estimados: todo procede de building_tasks.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"}
            onClick={() => setPeriod(p.key)}>
            {p.label}
          </Button>
        ))}
        <span className="mx-2 hidden h-5 w-px bg-border md:block" />
        <Button size="sm" variant={comercial === "todos" ? "default" : "outline"} onClick={() => setComercial("todos")}>
          Todos
        </Button>
        {allUsers.map((u) => (
          <Button key={u.id} size="sm" variant={comercial === u.id ? "default" : "outline"}
            onClick={() => setComercial(u.id)}>
            {u.name}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-base">Error al cargar los datos</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error.message}</CardContent>
        </Card>
      )}

      {loading && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!loading && !error && perUser.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sin tareas en el periodo seleccionado</CardTitle>
            <CardDescription>Prueba a ampliar el periodo o quitar el filtro por comercial.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!loading && !error && perUser.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {perUser.map((u) => (
            <Card key={u.userId}>
              <CardHeader>
                <CardTitle className="text-base">{u.name}</CardTitle>
                <CardDescription>{u.total} tareas en el periodo</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ["Activas", u.counts.activa],
                    ["Completadas", u.counts.completada],
                    ["No procede", u.counts.no_procede],
                    ["Bloqueadas", u.counts.bloqueada],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-xl font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Cumplimiento de plazo</div>
                    <div className="text-xl font-semibold tabular-nums">
                      {u.cumplimiento == null ? "—" : `${u.cumplimiento}%`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {u.conPlazo} tareas con fecha límite y cierre
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Tiempo hasta el cierre</div>
                    <div className="text-sm font-medium tabular-nums">
                      media {fmtHoras(u.avg)} · mediana {fmtHoras(u.med)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {u.nDur} tareas con creación y cierre registrados
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs text-muted-foreground">Mezcla por tipo</div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.mix.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                    {u.mix.map(([type, n]) => (
                      <Badge key={type} variant="secondary">{type}: {n}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Nota: building_tasks no registra un timestamp de inicio (started_at), por lo que el tiempo mostrado es
        creación → cierre, calculado sólo cuando ambos existen.
      </p>
    </div>
  );
}

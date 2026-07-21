import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import {
  Phone, PhoneCall, Mail, ClipboardList, FileSearch, AlertTriangle,
  Brain, MapPin, CheckSquare, ArrowRight, RefreshCw, Flame, CheckCircle2, Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { syncAssignedBuildingsTasks, TASK_DEFS, type Priority } from "@/lib/buildingTasks";
import { cn } from "@/lib/utils";

const ICONS: Record<string, any> = {
  Phone, PhoneCall, Mail, ClipboardList, FileSearch, AlertTriangle, Brain, MapPin,
};
const priorityBadge: Record<Priority, "destructive" | "warning" | "outline"> = {
  high: "destructive", medium: "warning", low: "outline",
};
const priorityLabel: Record<Priority, string> = { high: "Alta", medium: "Media", low: "Baja" };

export default function ComercialTareas() {
  const { user } = useAuth();
  const userId = user?.id;
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [syncing, setSyncing] = useState(false);

  // Auto-sync on first mount
  useEffect(() => {
    if (!userId) return;
    setSyncing(true);
    syncAssignedBuildingsTasks(userId).finally(() => {
      setSyncing(false);
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const { data, isLoading } = useQuery({
    queryKey: ["building_tasks_all", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [tasksRes, scoresRes] = await Promise.all([
        (supabase.from("building_tasks" as any) as any)
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        (supabase.from("v_building_score" as any) as any)
          .select("id,direccion,ciudad,score,score_total,score_activo"),
      ]);
      const tasks = (tasksRes.data ?? []) as any[];
      const scores = (scoresRes.data ?? []) as any[];
      const byId = new Map<string, any>();
      scores.forEach((s) => byId.set(s.id, s));
      return { tasks, byId };
    },
  });

  const tasks = data?.tasks ?? [];
  const byId = data?.byId ?? new Map();

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter === "pending" && (t.status === "completed" || t.status === "skipped"))
        return false;
      if (statusFilter === "completed" && t.status !== "completed") return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (typeFilter !== "all" && t.task_type !== typeFilter) return false;
      return true;
    });
  }, [tasks, statusFilter, priorityFilter, typeFilter]);

  const totalPending = tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length;
  const highPriority = tasks.filter(
    (t) => t.priority === "high" && t.status !== "completed" && t.status !== "skipped",
  ).length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const completedToday = tasks.filter(
    (t) => t.status === "completed" && t.completed_at && new Date(t.completed_at) >= today,
  ).length;
  const buildingsWithTasks = new Set(
    tasks
      .filter((t) => t.status === "pending" || t.status === "in_progress")
      .map((t) => t.building_id),
  ).size;

  // Group by building
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((t) => {
      const arr = map.get(t.building_id) ?? [];
      arr.push(t);
      map.set(t.building_id, arr);
    });
    const groups = Array.from(map.entries()).map(([buildingId, arr]) => {
      const highCount = arr.filter(
        (t) => t.priority === "high" && t.status !== "completed" && t.status !== "skipped",
      ).length;
      const pendingCount = arr.filter(
        (t) => t.status !== "completed" && t.status !== "skipped",
      ).length;
      return { buildingId, tasks: arr, highCount, pendingCount, building: byId.get(buildingId) };
    });
    groups.sort((a, b) => b.highCount - a.highCount || b.pendingCount - a.pendingCount);
    return groups;
  }, [filtered, byId]);

  const kpis = [
    { label: "Total pendientes", value: totalPending, icon: CheckSquare },
    { label: "Alta prioridad", value: highPriority, icon: Flame },
    { label: "Completadas hoy", value: completedToday, icon: CheckCircle2 },
    { label: "Edificios con tareas", value: buildingsWithTasks, icon: Building2 },
  ];

  const refresh = async () => {
    if (!userId) return;
    setSyncing(true);
    await syncAssignedBuildingsTasks(userId);
    setSyncing(false);
    qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
  };

  const toggle = async (id: string, completed: boolean) => {
    await (supabase.from("building_tasks" as any) as any)
      .update({
        status: completed ? "completed" : "pending",
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", id);
    qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operativa · Tareas"
        title="Mis tareas"
        subtitle={`${totalPending} pendientes en tu cartera`}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={syncing}>
            <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
            Re-evaluar todas
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <Eyebrow>{k.label}</Eyebrow>
                <k.icon className="h-4 w-4 text-muted-foreground/60" />
              </div>
              <div className="mt-3"><MetricValue size="xl">{k.value as any}</MetricValue></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Estado
            </span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendientes</SelectItem>
                <SelectItem value="completed">Completadas</SelectItem>
                <SelectItem value="all">Todas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Prioridad
            </span>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="high">Alta</SelectItem>
                <SelectItem value="medium">Media</SelectItem>
                <SelectItem value="low">Baja</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Tipo
            </span>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {isLoading || syncing ? "Cargando tareas…" : "No hay tareas con los filtros actuales."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <Card key={g.buildingId}>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate text-base">
                      {g.building?.direccion ?? "Edificio sin datos"}
                    </CardTitle>
                    {(g.building?.score_total ?? g.building?.score) != null && (
                      <span className="rounded-[3px] bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gold">
                        {Number(g.building?.score_total ?? g.building?.score).toFixed(0)}
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                    {g.building?.ciudad ?? "—"} · {g.pendingCount} pendientes
                    {g.highCount > 0 && ` · ${g.highCount} alta prioridad`}
                  </div>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link to={`/comercial/edificios/${g.buildingId}`}>
                    Ver edificio <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border-faint">
                  {g.tasks.map((t: any) => {
                    const Icon =
                      ICONS[TASK_DEFS[t.task_key as keyof typeof TASK_DEFS]?.icon] ?? ClipboardList;
                    const isCompleted = t.status === "completed" || t.status === "skipped";
                    return (
                      <li key={t.id} className={cn("px-5 py-3", isCompleted && "opacity-60")}>
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={isCompleted}
                            onCheckedChange={(c) => toggle(t.id, !!c)}
                            className="mt-1"
                          />
                          <div className="rounded-md bg-surface-1 p-2 text-gold">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className={cn("text-sm font-medium text-foreground", isCompleted && "line-through")}>
                              {t.title}
                            </div>
                            {t.description && (
                              <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Badge variant={priorityBadge[t.priority as Priority]} className="text-[9px]">
                              {priorityLabel[t.priority as Priority]}
                            </Badge>
                            <Badge
                              variant={t.task_type === "auto" ? "info" : "outline"}
                              className="text-[9px]"
                            >
                              {t.task_type === "auto" ? "Auto" : "Manual"}
                            </Badge>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

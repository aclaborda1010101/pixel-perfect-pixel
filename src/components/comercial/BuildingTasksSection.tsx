import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Eyebrow } from "@/components/common/Eyebrow";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Phone, PhoneCall, Mail, ClipboardList, FileSearch, AlertTriangle,
  Brain, MapPin, Plus, ChevronDown, ChevronRight, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TareaTarjetaTexto } from "@/components/comercial/TareaTarjetaTexto";
import { TASK_DEFS, type Priority } from "@/lib/buildingTasks";
import {
  filterVisibleOperationalTasks,
  VISIBLE_OPERATIONAL_TASK_OR_FILTER,
  operationalTaskBadge,
} from "@/lib/operationalTasks";
import { sortByDueThenPriority } from "@/lib/taskSchedule";
import { insertManualBuildingTask } from "@/lib/taskWriters";
import { TaskScheduleMeta, TaskTemporalBadge } from "@/components/comercial/TaskScheduleMeta";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { InterlocutorFlag } from "@/components/buildings/InterlocutorFlag";
import { useInterlocutores } from "@/hooks/useInterlocutores";
import {
  startBuildingTask,
  canStartTask,
  reopenBuildingTask,
  resolveBuildingTask,
} from "@/lib/taskStart";

const ICONS: Record<string, any> = {
  Phone, PhoneCall, Mail, ClipboardList, FileSearch, AlertTriangle, Brain, MapPin,
};

const priorityBadge: Record<Priority, "destructive" | "warning" | "outline"> = {
  high: "destructive",
  medium: "warning",
  low: "outline",
};
const priorityLabel: Record<Priority, string> = { high: "Alta", medium: "Media", low: "Baja" };

export function BuildingTasksSection({
  buildingId,
  userId,
}: {
  buildingId: string;
  userId: string;
}) {
  const qc = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [openNew, setOpenNew] = useState(false);

  const { data: tasks = [], isFetching } = useQuery({
    queryKey: ["building_tasks", buildingId, userId],
    enabled: !!buildingId && !!userId,
    queryFn: async () => {
      const { data } = await (supabase.from("building_tasks" as any) as any)
        .select("*")
        .eq("building_id", buildingId)
        .eq("user_id", userId)
        .or(VISIBLE_OPERATIONAL_TASK_OR_FILTER)
        .order("priority", { ascending: true })
        .order("task_type", { ascending: false })
        .order("created_at", { ascending: true });
      // Defensive client-side filter on top of the server-side filter.
      return filterVisibleOperationalTasks((data ?? []) as any[]);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      if (completed) {
        // Cierre ÚNICO vía RPC transaccional (estado + reposición).
        const done = await resolveBuildingTask(id, "completed");
        if (!done.ok) throw new Error(done.error ?? "No se pudo completar la tarea");
        return;
      }
      // Reapertura ÚNICA vía RPC (nunca UPDATE directo).
      const res = await reopenBuildingTask(id);
      if (!res.ok) throw new Error(res.error ?? "No se pudo reabrir la tarea");
    },
    onError: (e: Error) => toast({ title: "No se pudo reabrir", description: e.message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
    },
  });

  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await startBuildingTask(id);
      if (!res.ok) throw new Error(res.error ?? "No se pudo empezar la tarea");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
    },
    onError: (e: Error) => toast({ title: "No se pudo empezar", description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Nunca DELETE directo: la tarea se cancela con trazabilidad.
      const res = await resolveBuildingTask(id, "cancelled");
      if (!res.ok) throw new Error(res.error ?? "No se pudo cancelar la tarea");
    },
    onError: (e: Error) => toast({ title: "No se pudo cancelar", description: e.message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
      toast({ title: "Tarea cancelada" });
    },
  });

  const pending = tasks.filter((t) => t.status !== "completed" && t.status !== "skipped");
  const completed = tasks.filter((t) => t.status === "completed" || t.status === "skipped");

  const sortedPending = sortByDueThenPriority(pending);

  const { data: interlocutores = {} } = useInterlocutores([buildingId]);
  const interlocutor = interlocutores[buildingId] ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <Eyebrow>
            {pending.length} pendientes · {completed.length} completadas
          </Eyebrow>
          <CardTitle>Tareas del edificio</CardTitle>
          {interlocutor && (
            <div className="mt-1.5">
              <InterlocutorFlag nombre={interlocutor.nombre} />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <NewTaskDialog
            open={openNew}
            onOpenChange={setOpenNew}
            buildingId={buildingId}
            userId={userId}
            onCreated={() =>
              qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] })
            }
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sortedPending.length === 0 && !isFetching ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">
            No hay tareas pendientes. Puedes crear una tarea manual.
          </div>
        ) : (
          <ul className="divide-y divide-border-faint">
            {sortedPending.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={(c) => toggleMutation.mutate({ id: t.id, completed: c })}
                onStart={() => startMutation.mutate(t.id)}
                onDelete={t.task_type === "manual" ? () => deleteMutation.mutate(t.id) : undefined}
              />
            ))}
          </ul>
        )}

        {completed.length > 0 && (
          <div className="border-t border-border-faint">
            <button
              type="button"
              onClick={() => setShowCompleted((s) => !s)}
              className="flex w-full items-center gap-2 px-5 py-3 text-left font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground"
            >
              {showCompleted ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {completed.length} completadas
            </button>
            {showCompleted && (
              <ul className="divide-y divide-border-faint">
                {completed.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={(c) => toggleMutation.mutate({ id: t.id, completed: c })}
                    onDelete={
                      t.task_type === "manual" ? () => deleteMutation.mutate(t.id) : undefined
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  onToggle,
  onStart,
  onDelete,
}: {
  task: any;
  onToggle: (completed: boolean) => void;
  onStart?: () => void;
  onDelete?: () => void;
}) {
  const Icon = ICONS[TASK_DEFS[task.task_key as keyof typeof TASK_DEFS]?.icon] ?? ClipboardList;
  const isCompleted = task.status === "completed" || task.status === "skipped";
  return (
    <li className={cn("px-5 py-3", isCompleted && "opacity-60")}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={isCompleted}
          onCheckedChange={(c) => onToggle(!!c)}
          className="mt-1"
        />
        <div className="rounded-md bg-surface-1 p-2 text-gold">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "text-base font-bold leading-snug text-foreground",
              isCompleted && "line-through",
            )}
          >
            {task.title}
          </div>
          <TaskScheduleMeta task={task} />
          <TareaTarjetaTexto description={task.description} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {task.starts_at && (
              <span>Empieza: {new Date(task.starts_at).toLocaleString("es-ES")}</span>
            )}
            {task.due_date && (
              <span>· Vence: {new Date(task.due_date).toLocaleString("es-ES")}</span>
            )}
            {task.started_at ? (
              <span>· Inicio real: {new Date(task.started_at).toLocaleString("es-ES")}</span>
            ) : (
              <span>· Sin inicio registrado</span>
            )}
            {task.completed_at && <span>· Cierre: {new Date(task.completed_at).toLocaleString("es-ES")}</span>}
            {onStart && canStartTask(task) && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onStart}>
                Empezar
              </Button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <TaskTemporalBadge task={task} />
            <Badge variant={priorityBadge[task.priority as Priority]} className="text-[9px]">
              {priorityLabel[task.priority as Priority]}
            </Badge>
            {(() => {
              const origin = operationalTaskBadge(task);
              return (
                <Badge variant={origin.variant} className="text-[9px]">
                  {origin.label}
                </Badge>
              );
            })()}
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
              title="Cancelar tarea"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function NewTaskDialog({
  open, onOpenChange, buildingId, userId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  buildingId: string;
  userId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [subtype, setSubtype] = useState<"posible_interes" | "otro">("otro");
  const [startsAt, setStartsAt] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    let error: { message: string } | null = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const author = auth?.user?.id;
      if (!author) throw new Error("Sesión no válida: la tarea manual exige autor.");
      const start = startsAt ? new Date(startsAt).toISOString() : new Date().toISOString();
      const due = dueDate
        ? new Date(dueDate).toISOString()
        : new Date(Date.parse(start) + 86400000).toISOString();
      const res = await insertManualBuildingTask(supabase as any, {
        building_id: buildingId,
        user_id: userId,
        created_by: author,
        subject_type: "building",
        subject_id: buildingId,
        manual_subtype: subtype,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        starts_at: start,
        due_date: due,
      });
      error = (res as any)?.error ?? null;
    } catch (e: any) {
      error = { message: e?.message ?? "No se pudo crear la tarea" };
    }
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTitle(""); setDescription(""); setPriority("medium");
    setSubtype("otro"); setStartsAt(""); setDueDate("");
    onOpenChange(false);
    onCreated();
    toast({ title: "Tarea creada" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="gold">
          <Plus className="h-3 w-3" /> Nueva tarea
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva tarea manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Título
            </label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Hablar con portero" />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Descripción
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                Prioridad
              </label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="low">Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                Tipo
              </label>
              <Select value={subtype} onValueChange={(v) => setSubtype(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="posible_interes">Posible interés</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                Empieza
              </label>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                Fecha límite
              </label>
              <Input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="gold" onClick={submit} disabled={saving || !title.trim()}>
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

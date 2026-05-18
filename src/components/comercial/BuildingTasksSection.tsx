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
  Brain, MapPin, RefreshCw, Plus, ChevronDown, ChevronRight, Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { syncBuildingTasks, TASK_DEFS, type Priority } from "@/lib/buildingTasks";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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
        .order("priority", { ascending: true })
        .order("task_type", { ascending: false })
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => syncBuildingTasks(buildingId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
      toast({ title: "Tareas re-evaluadas" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      await (supabase.from("building_tasks" as any) as any)
        .update({
          status: completed ? "completed" : "pending",
          completed_at: completed ? new Date().toISOString() : null,
        })
        .eq("id", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      qc.invalidateQueries({ queryKey: ["building_tasks_all", userId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await (supabase.from("building_tasks" as any) as any).delete().eq("id", id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["building_tasks", buildingId, userId] });
      toast({ title: "Tarea eliminada" });
    },
  });

  const pending = tasks.filter((t) => t.status !== "completed" && t.status !== "skipped");
  const completed = tasks.filter((t) => t.status === "completed" || t.status === "skipped");

  const prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sortedPending = [...pending].sort((a, b) => {
    const p = (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9);
    if (p !== 0) return p;
    if (a.task_type !== b.task_type) return a.task_type === "auto" ? -1 : 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <Eyebrow>
            {pending.length} pendientes · {completed.length} completadas
          </Eyebrow>
          <CardTitle>Tareas del edificio</CardTitle>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw className={cn("h-3 w-3", syncMutation.isPending && "animate-spin")} />
            Re-evaluar
          </Button>
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
            No hay tareas pendientes. Pulsa <em>Re-evaluar</em> para detectar nuevas.
          </div>
        ) : (
          <ul className="divide-y divide-border-faint">
            {sortedPending.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onToggle={(c) => toggleMutation.mutate({ id: t.id, completed: c })}
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
  onDelete,
}: {
  task: any;
  onToggle: (completed: boolean) => void;
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
              "text-sm font-medium text-foreground",
              isCompleted && "line-through",
            )}
          >
            {task.title}
          </div>
          {task.description && (
            <div className="mt-0.5 text-xs text-muted-foreground">{task.description}</div>
          )}
          {task.due_date && (
            <div className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Vence: {new Date(task.due_date).toLocaleDateString("es")}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <Badge variant={priorityBadge[task.priority as Priority]} className="text-[9px]">
              {priorityLabel[task.priority as Priority]}
            </Badge>
            <Badge
              variant={task.task_type === "auto" ? "info" : "outline"}
              className="text-[9px]"
            >
              {task.task_type === "auto" ? "Auto" : "Manual"}
            </Badge>
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
              title="Eliminar"
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
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await (supabase.from("building_tasks" as any) as any).insert({
      building_id: buildingId,
      user_id: userId,
      task_type: "manual",
      title: title.trim(),
      description: description.trim() || null,
      priority,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      status: "pending",
    });
    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setTitle(""); setDescription(""); setPriority("medium"); setDueDate("");
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
                Fecha límite
              </label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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

import { CalendarClock, CalendarPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  plannedDate, formatDate, formatDateTime, temporalState, temporalLabel, temporalBadge,
} from "@/lib/taskSchedule";
import { cn } from "@/lib/utils";

export function TaskTemporalBadge({ task, className }: { task: any; className?: string }) {
  const st = temporalState(task);
  return (
    <Badge variant={temporalBadge[st]} className={cn("text-[9px]", className)}>
      {temporalLabel[st]}
    </Badge>
  );
}

export function TaskScheduleMeta({ task, className }: { task: any; className?: string }) {
  const planned = plannedDate(task);
  const plannedTxt = planned
    ? planned.source === "task_key"
      ? formatDate(planned.iso)
      : formatDateTime(planned.iso)
    : null;
  const dueTxt = formatDate(task?.due_date);

  return (
    <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {plannedTxt && (
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          <CalendarPlus className="h-3 w-3" />
          Planificada desde: <span className="text-foreground">{plannedTxt}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
        <CalendarClock className="h-3 w-3" />
        Fecha límite:{" "}
        <span className={cn(dueTxt ? "text-foreground" : "italic")}>
          {dueTxt ?? "Sin fecha límite"}
        </span>
      </span>
    </div>
  );
}

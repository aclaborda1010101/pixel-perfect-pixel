import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, Loader2, AlertCircle, FileEdit, PhoneOff } from "lucide-react";

export type Status =
  | "draft"
  | "analyzing"
  | "analyzed"
  | "action_pending"
  | "done"
  | "review"
  | "no_summary";

const config: Record<Status, { label: string; cls: string; Icon: any }> = {
  draft: { label: "Borrador", cls: "bg-muted text-muted-foreground border-transparent", Icon: FileEdit },
  analyzing: { label: "Analizando", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-transparent", Icon: Loader2 },
  analyzed: { label: "Analizada", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent", Icon: CheckCircle2 },
  action_pending: { label: "Acción pendiente", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent", Icon: Clock },
  done: { label: "Completado", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-transparent", Icon: CheckCircle2 },
  review: { label: "Revisión humana", cls: "bg-destructive/15 text-destructive border-transparent", Icon: AlertCircle },
  no_summary: { label: "Por analizar", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-transparent", Icon: PhoneOff },
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const c = config[status];
  const Icon = c.Icon;
  return (
    <Badge className={cn("gap-1 font-medium", c.cls, className)}>
      <Icon className={cn("h-3 w-3", status === "analyzing" && "animate-spin")} />
      {label ?? c.label}
    </Badge>
  );
}
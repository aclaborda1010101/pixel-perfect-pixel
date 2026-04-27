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
  analyzing: { label: "Analizando", cls: "bg-info-soft text-info border-transparent", Icon: Loader2 },
  analyzed: { label: "Analizada", cls: "bg-success-soft text-success border-transparent", Icon: CheckCircle2 },
  action_pending: { label: "Acción pendiente", cls: "bg-warning-soft text-warning border-transparent", Icon: Clock },
  done: { label: "Completado", cls: "bg-success-soft text-success border-transparent", Icon: CheckCircle2 },
  review: { label: "Revisión humana", cls: "bg-destructive-soft text-destructive border-transparent", Icon: AlertCircle },
  no_summary: { label: "Por analizar", cls: "bg-warning-soft text-warning border-transparent", Icon: PhoneOff },
};

export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const c = config[status];
  const Icon = c.Icon;
  return (
    <Badge className={cn("gap-1 normal-case tracking-normal text-[11px] font-medium rounded-[4px]", c.cls, className)}>
      <Icon className={cn("h-3 w-3", status === "analyzing" && "animate-spin")} />
      {label ?? c.label}
    </Badge>
  );
}
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveBuildingTask, reopenBuildingTask, canReopenTask } from "@/lib/taskStart";

const CERRADOS = ["completed", "skipped", "no_procede", "cancelled", "superseded"];

function fmt(d?: string | null) {
  return d ? new Date(d).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : null;
}

/** Nombre legible de quien cerró la tarea (si lo hay). */
function useNombreCierre(userId?: string | null) {
  return useQuery({
    queryKey: ["perfil_cierre", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles" as any) as any)
        .select("id,full_name")
        .eq("id", userId)
        .maybeSingle();
      return (data as any)?.full_name ?? null;
    },
  });
}

/**
 * Botón de respaldo SIEMPRE visible para cerrar una tarea a mano.
 * Idempotente: pulsarlo sobre una tarea ya cerrada no rompe nada.
 */
export function MarcarTerminadaButton({
  task,
  onDone,
  className,
}: {
  task: any;
  onDone?: () => void | Promise<void>;
  className?: string;
}) {
  const [guardando, setGuardando] = useState(false);
  const cerrada = CERRADOS.includes(String(task?.status));
  const { data: nombre } = useNombreCierre(cerrada ? task?.completed_by : null);

  const cerrar = async () => {
    setGuardando(true);
    try {
      const res = await resolveBuildingTask(task.id, "completed", "Cerrada a mano desde la tarjeta de tarea");
      if (!res.ok) throw new Error(res.error ?? "No se pudo cerrar la tarea");
      toast.success("Tarea marcada como terminada");
      await onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cerrar la tarea");
    } finally {
      setGuardando(false);
    }
  };

  const reabrir = async () => {
    setGuardando(true);
    try {
      const res = await reopenBuildingTask(task.id);
      if (!res.ok) throw new Error(res.error ?? "No se pudo reabrir la tarea");
      toast.success("Tarea reabierta");
      await onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo reabrir la tarea");
    } finally {
      setGuardando(false);
    }
  };

  if (cerrada) {
    const fecha = fmt(task?.completed_at);
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-[3px] bg-emerald-500/10 px-1.5 py-0.5 text-emerald-500">
            <CheckCircle2 className="h-3 w-3" /> Terminada
          </span>
          <span>
            {nombre ? `por ${nombre}` : ""} {fecha ? `el ${fecha}` : ""}
          </span>
          {canReopenTask(task) && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={guardando}
              onClick={reabrir}
            >
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
              Reabrir
            </Button>
          )}
        </div>
        {task?.completed_note && (
          <div className="mt-1 text-[11px] text-muted-foreground">Nota: {task.completed_note}</div>
        )}
      </div>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className={`h-7 px-2 text-[11px] ${className ?? ""}`}
      disabled={guardando}
      onClick={cerrar}
    >
      {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
      Marcar como terminada
    </Button>
  );
}

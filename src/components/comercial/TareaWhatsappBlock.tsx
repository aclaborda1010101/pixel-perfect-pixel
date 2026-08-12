import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, MessageCircle, PhoneCall, Search, TriangleAlert } from "lucide-react";
import { parseGeneratedTaskKey, resumenConsentimiento, tieneConsentimiento } from "@/lib/whatsappTarjeta";
import { resolveBuildingTask } from "@/lib/taskStart";
import { useBloqueoContacto } from "@/hooks/useBloqueoContacto";
import { BloqueoContactoBadge, ExcepcionContactoButton } from "@/components/buildings/ContactoBloqueado";

type Props = {
  task: any;
  /** Se llama tras completar la tarea para refrescar y encadenar la siguiente. */
  onCompleted: () => void | Promise<void>;
};

/** Bloque de consentimiento y envío de WhatsApp de la tarjeta de primera llamada. */
export function TareaWhatsappBlock({ task, onCompleted }: Props) {
  const qc = useQueryClient();
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  const ownerId = parseGeneratedTaskKey(task?.task_key)?.subjectId ?? null;
  const abierta = task?.status === "pending" || task?.status === "in_progress";
  const { bloqueado } = useBloqueoContacto(ownerId, task?.building_id ?? null);

  const { data: owner } = useQuery({
    queryKey: ["tarea_wa_owner", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data } = await (supabase.from("owners" as any) as any)
        .select("id,nombre,nombre_display,telefono")
        .eq("id", ownerId)
        .maybeSingle();
      return (data ?? null) as any;
    },
  });

  const { data: consentimiento } = useQuery({
    queryKey: ["tarea_wa_consent", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const { data } = await (supabase.from("wa_consent_signals" as any) as any)
        .select("owner_id,veredicto,detectado_at,fecha_llamada,hs_call_id,registrado_por,task_id,fuente")
        .eq("owner_id", ownerId);
      const filas = (data ?? []) as any[];
      return {
        autorizado: tieneConsentimiento(filas, String(ownerId)),
        resumen: resumenConsentimiento(filas, String(ownerId)),
        filas,
      };
    },
  });

  const { data: ajustes } = useQuery({
    queryKey: ["wa_modo_prueba"],
    queryFn: async () => {
      const { data } = await (supabase.from("app_settings" as any) as any)
        .select("key,value")
        .in("key", ["wa_modo_prueba", "wa_numero_prueba"]);
      const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
      const raw = (map.get("wa_modo_prueba") as any)?.activo;
      return {
        modoPrueba: raw === undefined ? true : !!raw,
        numeroPrueba: String((map.get("wa_numero_prueba") as any)?.numero ?? ""),
      };
    },
  });

  if (!ownerId) return null;
  const autorizado = !!consentimiento?.autorizado;
  const resumen = consentimiento?.resumen ?? null;
  const fechaAutorizacion = resumen?.fecha
    ? new Date(resumen.fecha).toLocaleDateString("es-ES")
    : null;
  const origenAutorizacion =
    resumen?.origen === "llamada" ? "llamada" : resumen?.origen === "registro" ? "registro" : null;
  const telefono = owner?.telefono ?? null;

  const marcarConsentimiento = async (valor: boolean) => {
    if (!valor || autorizado) return;
    setGuardando(true);
    try {
      const { data, error } = await supabase.functions.invoke("wa_task_consent", {
        body: { task_id: task.id, owner_id: ownerId },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any).error);
      toast.success("Autorización guardada");
      await qc.invalidateQueries({ queryKey: ["tarea_wa_consent", ownerId] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar la autorización");
    } finally {
      setGuardando(false);
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const { data, error } = await supabase.functions.invoke("wa_send_task_message", {
        body: { task_id: task.id, owner_id: ownerId },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(res.error);
      toast.success(
        res?.modo === "real"
          ? "WhatsApp enviado"
          : res?.modo === "prueba"
            ? "Enviado al número de prueba"
            : "Registrado como prueba (sin envío real)",
      );
      const done = await resolveBuildingTask(task.id, "completed", "WhatsApp enviado desde la tarjeta");
      if (!done.ok) throw new Error(done.error ?? "No se pudo completar la tarea");
      await onCompleted();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo enviar el WhatsApp");
    } finally {
      setEnviando(false);
    }
  };

  const marcarInvestigacion = async () => {
    setCerrando(true);
    try {
      const done = await resolveBuildingTask(
        task.id,
        "completed",
        "Sin teléfono del propietario: marcado para investigación",
      );
      if (!done.ok) throw new Error(done.error ?? "No se pudo cerrar la tarea");
      toast.success("Marcado para investigación");
      await onCompleted();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cerrar la tarea");
    } finally {
      setCerrando(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border-faint bg-surface-1/40 p-3">
      {ajustes?.modoPrueba && (
        <div className="flex items-center gap-2 rounded-[3px] bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          Modo prueba activo: los mensajes no llegan a los propietarios
          {ajustes.numeroPrueba ? ` (van al ${ajustes.numeroPrueba})` : " (quedan solo registrados)"}.
        </div>
      )}

      {telefono ? (
        <>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <Checkbox
              checked={autorizado}
              disabled={autorizado || guardando || !abierta}
              onCheckedChange={(c) => marcarConsentimiento(!!c)}
              className="mt-0.5"
            />
            <span>El propietario ha autorizado por teléfono el envío de WhatsApp.</span>
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
          </label>
          {autorizado && (
            <div className="pl-6 text-[11px] text-muted-foreground">
              {fechaAutorizacion
                ? `Autorizado previamente el ${fechaAutorizacion}`
                : "Autorizado previamente"}
              {origenAutorizacion ? ` (${origenAutorizacion})` : ""}. Solo un administrador puede
              retirar esta autorización.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="gold"
              className="h-7 px-2 text-[11px]"
              disabled={!autorizado || enviando || !abierta || bloqueado}
              onClick={enviar}
            >
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
              Enviar WhatsApp
            </Button>
            {bloqueado ? (
              <>
                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled>
                  <PhoneCall className="h-3 w-3" /> Preparar llamada
                </Button>
                <BloqueoContactoBadge />
                {task?.building_id && ownerId && (
                  <ExcepcionContactoButton buildingId={String(task.building_id)} ownerId={String(ownerId)} />
                )}
              </>
            ) : (
              <Button asChild size="sm" variant="outline" className="h-7 px-2 text-[11px]">
                <Link to={`/comercial/preparar/${ownerId}`}>
                  <PhoneCall className="h-3 w-3" /> Preparar llamada
                </Link>
              </Button>
            )}
            {autorizado && <Badge variant="outline" className="text-[9px]">Autorizado</Badge>}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] text-muted-foreground">
            Este propietario no tiene teléfono en la ficha, así que no se le puede llamar ni escribir.
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            disabled={cerrando || !abierta}
            onClick={marcarInvestigacion}
          >
            {cerrando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            Marcar para investigación
          </Button>
        </div>
      )}
    </div>
  );
}

/** Botón de preparación de llamada para tarjetas con propietario. */
export function PrepararLlamadaButton({ task }: { task: any }) {
  const ownerId = parseGeneratedTaskKey(task?.task_key)?.subjectId ?? null;
  const { bloqueado } = useBloqueoContacto(ownerId, task?.building_id ?? null);
  if (!ownerId) return null;
  if (bloqueado) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled>
          <PhoneCall className="h-3 w-3" /> Preparar llamada
        </Button>
        <BloqueoContactoBadge />
        {task?.building_id && (
          <ExcepcionContactoButton buildingId={String(task.building_id)} ownerId={String(ownerId)} />
        )}
      </div>
    );
  }
  return (
    <Button asChild size="sm" variant="outline" className="mt-2 h-6 px-2 text-[11px]">
      <Link to={`/comercial/preparar/${ownerId}`}>
        <PhoneCall className="h-3 w-3" /> Preparar llamada
      </Link>
    </Button>
  );
}

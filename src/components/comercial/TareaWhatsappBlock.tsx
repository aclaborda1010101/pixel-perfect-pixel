import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  const [preparando, setPreparando] = useState(false);
  const [vista, setVista] = useState<null | {
    textoOriginal: string;
    modo: string;
    telefonoDestino: string | null;
    telefonoPropietario: string | null;
    modoPrueba: boolean;
    numeroPrueba: string | null;
  }>(null);
  const [texto, setTexto] = useState("");

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
        .select("owner_id,veredicto,detectado_at,fecha_llamada,hs_call_id,registrado_por,task_id,fuente,origen,review_status,review_reason")
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
  const filasConsent = (consentimiento?.filas ?? []) as any[];
  const pendienteRevision = !autorizado &&
    filasConsent.some((f) => String(f?.review_status ?? "") === "pendiente_revision");
  const motivoRevision = filasConsent.find((f) => f?.review_reason)?.review_reason ?? null;
  const revocado = !!resumen?.revocado;

  const marcarConsentimiento = async () => {
    if (autorizado) return;
    setGuardando(true);
    try {
      const { data, error } = await supabase.functions.invoke("wa_task_consent", {
        body: { task_id: task.id, owner_id: ownerId, cita_textual: cita.trim() },
      });
      if (error) throw error;
      if ((data as any)?.ok === false) throw new Error((data as any).error);
      setPidiendoCita(false);
      setCita("");
      toast.success(
        (data as any)?.requiere_revision
          ? "Registrado como declaración tuya: queda pendiente de revisión y no se envía al CRM."
          : "Autorización guardada con la frase del propietario.",
      );
      await qc.invalidateQueries({ queryKey: ["tarea_wa_consent", ownerId] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar la autorización");
    } finally {
      setGuardando(false);
    }
  };

  /** Paso 1: monta el mensaje real y abre la ventana de confirmación. */
  const abrirVistaPrevia = async () => {
    if (!autorizado) {
      toast.error("Falta la autorización del propietario");
      return;
    }
    setPreparando(true);
    try {
      const { data, error } = await supabase.functions.invoke("wa_send_task_message", {
        body: { task_id: task.id, owner_id: ownerId, accion: "preview" },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(res.error);
      setTexto(String(res?.texto ?? ""));
      setVista({
        textoOriginal: String(res?.texto ?? ""),
        modo: String(res?.modo ?? "simulado"),
        telefonoDestino: res?.telefono_destino ?? null,
        telefonoPropietario: res?.telefono_propietario ?? null,
        modoPrueba: !!res?.modo_prueba,
        numeroPrueba: res?.numero_prueba ?? null,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo preparar el mensaje");
    } finally {
      setPreparando(false);
    }
  };

  const enviar = async () => {
    setEnviando(true);
    let editadoAMano = false;
    try {
      const { data, error } = await supabase.functions.invoke("wa_send_task_message", {
        body: { task_id: task.id, owner_id: ownerId, texto },
      });
      if (error) throw error;
      const res = data as any;
      if (res?.ok === false) throw new Error(res.error);
      editadoAMano = !!res?.editado_a_mano;
      setVista(null);
      toast.success(
        res?.modo === "real"
          ? "WhatsApp enviado"
          : res?.modo === "prueba"
            ? "Enviado al número de prueba"
            : "Registrado como prueba (sin envío real)",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo enviar el WhatsApp");
      setEnviando(false);
      return;
    }

    // PASO 2 (independiente): cerrar la tarea. Si falla, el WhatsApp YA se envió.
    try {
      const done = await resolveBuildingTask(
        task.id,
        "completed",
        editadoAMano
          ? "WhatsApp enviado desde la tarjeta (texto modificado a mano)"
          : "WhatsApp enviado desde la tarjeta",
      );
      if (!done.ok) throw new Error(done.error ?? "No se pudo completar la tarea");
      await onCompleted();
    } catch (e: any) {
      toast.error(
        "El WhatsApp se ha enviado, pero no hemos podido cerrar la tarea: ciérrala con el botón «Marcar como terminada».",
      );
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
              onCheckedChange={(c) => { if (c) setPidiendoCita(true); }}
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
          {!autorizado && pendienteRevision && (
            <div className="pl-6 text-[11px] text-amber-500">
              Hay una autorización registrada que está <strong>pendiente de revisión</strong>
              {motivoRevision ? ` (${motivoRevision})` : ""}. Hasta que se apruebe no se puede enviar
              WhatsApp ni se comunica al CRM.
            </div>
          )}
          {!autorizado && revocado && !pendienteRevision && (
            <div className="pl-6 text-[11px] text-destructive">
              Esta persona <strong>retiró</strong> su autorización. No se le puede escribir por WhatsApp.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="gold"
              className="h-7 px-2 text-[11px]"
              disabled={!autorizado || preparando || enviando || !abierta || bloqueado}
              onClick={abrirVistaPrevia}
            >
              {preparando ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
              Revisar y enviar WhatsApp
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
                <Link to={`/comercial/preparar/${ownerId}?task=${task.id}`}>
                  <PhoneCall className="h-3 w-3" /> Preparar llamada
                </Link>
              </Button>
            )}
            {autorizado && <Badge variant="outline" className="text-[9px]">Autorizado</Badge>}
          </div>

          <Dialog open={pidiendoCita} onOpenChange={(o) => { if (!guardando) setPidiendoCita(o); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>¿Qué dijo exactamente el propietario?</DialogTitle>
                <DialogDescription>
                  Copia su frase literal pidiendo o aceptando el WhatsApp. Si no la pones, queda
                  registrado como declaración tuya y pasa a revisión: no se envía nada ni se anota en el CRM.
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={cita}
                onChange={(e) => setCita(e.target.value)}
                rows={3}
                placeholder="Ej.: Vale, pues mándame el WhatsApp."
                className="text-xs"
                aria-label="Frase literal del propietario"
              />
              <DialogFooter>
                <Button size="sm" variant="outline" disabled={guardando} onClick={() => setPidiendoCita(false)}>
                  Cancelar
                </Button>
                <Button size="sm" variant="gold" disabled={guardando} onClick={() => marcarConsentimiento()}>
                  {guardando && <Loader2 className="h-3 w-3 animate-spin" />} Guardar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!vista} onOpenChange={(o) => { if (!o && !enviando) setVista(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Revisa el mensaje antes de enviarlo</DialogTitle>
                <DialogDescription>
                  Esto es exactamente lo que recibirá la persona. Puedes cambiarlo antes de enviar.
                </DialogDescription>
              </DialogHeader>

              {vista?.modoPrueba && (
                <div className="flex items-start gap-2 rounded-[3px] bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-500">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    Modo prueba activo: este mensaje NO le llegará al propietario
                    {vista?.numeroPrueba ? `; se enviará al número de prueba ${vista.numeroPrueba}` : "; solo quedará registrado"}.
                  </span>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Para: <span className="text-foreground">{owner?.nombre_display ?? owner?.nombre ?? "propietario"}</span>
                {" · "}
                Teléfono de destino:{" "}
                <span className="text-foreground">
                  {vista?.telefonoDestino ?? "ninguno (queda solo registrado)"}
                </span>
                {vista?.modoPrueba && vista?.telefonoPropietario && (
                  <> · teléfono del propietario: {vista.telefonoPropietario} (no se usa)</>
                )}
              </div>

              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={7}
                className="text-xs"
                aria-label="Mensaje que se va a enviar"
              />
              {vista && texto.trim() !== vista.textoOriginal.trim() && (
                <div className="text-[11px] text-amber-500">
                  Texto modificado a mano: se enviará tal cual y quedará registrado como modificado.
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" size="sm" disabled={enviando} onClick={() => setVista(null)}>
                  Cancelar
                </Button>
                <Button
                  variant="gold"
                  size="sm"
                  disabled={enviando || texto.trim() === ""}
                  onClick={enviar}
                >
                  {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
                  Enviar WhatsApp
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
      <Link to={`/comercial/preparar/${ownerId}?task=${task.id}`}>
        <PhoneCall className="h-3 w-3" /> Preparar llamada
      </Link>
    </Button>
  );
}

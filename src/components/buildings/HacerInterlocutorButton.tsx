import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { UserCheck, UserX } from "lucide-react";

/**
 * Botón de un clic para marcar (o quitar) a un propietario como interlocutor
 * único del edificio. Reutiliza las RPC existentes sin modificarlas.
 */
export function HacerInterlocutorButton({
  buildingId,
  ownerId,
  ownerNombre,
  esActual,
  hayInterlocutor,
  puedeGestionar,
  onChanged,
}: {
  buildingId: string;
  ownerId: string;
  ownerNombre: string | null;
  esActual: boolean;
  hayInterlocutor: boolean;
  puedeGestionar: boolean;
  onChanged?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  if (!puedeGestionar) return null;

  const nombre = ownerNombre?.trim() || "este propietario";
  const quitar = esActual;

  const confirmar = async () => {
    setTrabajando(true);
    const { error } = quitar
      ? await (supabase.rpc as any)("clear_building_interlocutor", {
          p_building_id: buildingId, p_motivo: motivo || null,
        })
      : await (supabase.rpc as any)("set_building_interlocutor", {
          p_building_id: buildingId, p_owner_id: ownerId, p_motivo: motivo || null,
        });
    setTrabajando(false);
    if (error) {
      toast({
        title: quitar ? "No se ha podido quitar el interlocutor" : "No se ha podido marcar el interlocutor",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: quitar ? "Interlocutor retirado" : `${nombre} es ahora el interlocutor` });
    setMotivo("");
    setAbierto(false);
    onChanged?.();
  };

  const etiqueta = quitar
    ? "Quitar"
    : hayInterlocutor
    ? "Cambiar interlocutor a este"
    : "Hacer interlocutor";

  return (
    <>
      <Button
        size="sm"
        variant={quitar ? "outline" : "gold"}
        onClick={() => setAbierto(true)}
      >
        {quitar ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
        {etiqueta}
      </Button>

      <AlertDialog open={abierto} onOpenChange={setAbierto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {quitar ? `¿Quitar a ${nombre} como interlocutor?` : `¿Marcar a ${nombre} como interlocutor único?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {quitar
                ? "Se podrá volver a hablar con cualquier propietario del edificio."
                : hayInterlocutor
                ? "Sustituye al interlocutor actual. El resto de propietarios quedará bloqueado para contacto."
                : "El resto de propietarios quedará bloqueado para contacto."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="h-9 text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={trabajando}
              onClick={(e) => { e.preventDefault(); void confirmar(); }}
            >
              {quitar ? "Quitar" : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

import { useState } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { motivoExcepcionValido, puedeAutorizarExcepcion, textoBloqueoContacto } from "@/lib/bloqueoContacto";

/** Etiqueta con candado para propietarios a los que hoy no se puede contactar. */
export function BloqueoContactoBadge({ nombreInterlocutor }: { nombreInterlocutor?: string | null }) {
  return (
    <Badge variant="outline" className="h-5 gap-1 border-destructive/40 bg-destructive/10 px-1.5 text-[9px] text-destructive">
      <Lock className="h-2.5 w-2.5" /> {textoBloqueoContacto(nombreInterlocutor)}
    </Badge>
  );
}

type ExcepcionProps = {
  buildingId: string;
  ownerId: string;
  onAutorizada?: () => void;
};

/** Permiso puntual para contactar igualmente: solo administración o responsable de equipo. */
export function ExcepcionContactoButton({ buildingId, ownerId, onAutorizada }: ExcepcionProps) {
  const { role } = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!puedeAutorizarExcepcion(role)) return null;

  const confirmar = async () => {
    if (!motivoExcepcionValido(motivo)) {
      toast.error("Escribe el motivo de la excepción.");
      return;
    }
    setGuardando(true);
    try {
      const { data, error } = await (supabase.rpc as any)("registrar_excepcion_contacto", {
        p_building_id: buildingId,
        p_owner_id: ownerId,
        p_motivo: motivo,
      });
      if (error) throw error;
      if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "No se pudo autorizar");
      toast.success("Contacto autorizado y registrado");
      setOpen(false);
      setMotivo("");
      onAutorizada?.();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo autorizar el contacto");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]">
          Contactar de todos modos
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contactar de todos modos</DialogTitle>
          <DialogDescription>
            Este edificio tiene un interlocutor activo. Explica por qué hace falta hablar con otro
            propietario; quedará registrado con tu nombre y la fecha.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Motivo (obligatorio)"
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="gold" onClick={confirmar} disabled={guardando || !motivoExcepcionValido(motivo)}>
            Confirmar y registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
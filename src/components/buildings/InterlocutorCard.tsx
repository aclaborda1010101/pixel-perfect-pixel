import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/common/Eyebrow";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { toast } from "@/hooks/use-toast";
import { InterlocutorFlag } from "@/components/buildings/InterlocutorFlag";

type Propietario = { owner_id: string; nombre: string | null };

/**
 * Interlocutor activo del edificio.
 * Solo dirección y responsables de equipo pueden marcarlo o quitarlo;
 * el resto ve únicamente el aviso informativo.
 */
export function InterlocutorCard({
  buildingId,
  onChanged,
}: {
  buildingId: string;
  onChanged?: () => void;
}) {
  const { role } = useCurrentRole();
  const puedeGestionar = role === "admin" || role === "sales_manager";
  const [propietarios, setPropietarios] = useState<Propietario[]>([]);
  const [actual, setActual] = useState<{ ownerId: string | null; nombre: string | null; motivo: string | null; at: string | null } | null>(null);
  const [elegido, setElegido] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  const cargar = async () => {
    const [{ data: b }, { data: bo }] = await Promise.all([
      (supabase.from("buildings") as any)
        .select("interlocutor_owner_id, interlocutor_motivo, interlocutor_marcado_at, owners:interlocutor_owner_id(nombre)")
        .eq("id", buildingId).maybeSingle(),
      (supabase.from("building_owners") as any)
        .select("owner_id, owners:owner_id(nombre)").eq("building_id", buildingId),
    ]);
    setPropietarios(((bo ?? []) as any[]).map((r) => ({ owner_id: r.owner_id, nombre: r.owners?.nombre ?? null })));
    const oid = (b as any)?.interlocutor_owner_id ?? null;
    setActual(oid ? {
      ownerId: oid,
      nombre: (b as any)?.owners?.nombre ?? null,
      motivo: (b as any)?.interlocutor_motivo ?? null,
      at: (b as any)?.interlocutor_marcado_at ?? null,
    } : null);
  };

  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [buildingId]);

  const marcar = async () => {
    if (!elegido) return;
    setTrabajando(true);
    const { error } = await (supabase.rpc as any)("set_building_interlocutor", {
      p_building_id: buildingId, p_owner_id: elegido, p_motivo: motivo || null,
    });
    setTrabajando(false);
    if (error) {
      toast({ title: "No se ha podido marcar el interlocutor", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Interlocutor activo marcado" });
    setMotivo("");
    await cargar();
    onChanged?.();
  };

  const quitar = async () => {
    setTrabajando(true);
    const { error } = await (supabase.rpc as any)("clear_building_interlocutor", {
      p_building_id: buildingId, p_motivo: motivo || null,
    });
    setTrabajando(false);
    if (error) {
      toast({ title: "No se ha podido quitar el interlocutor", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Interlocutor retirado" });
    setMotivo("");
    await cargar();
    onChanged?.();
  };

  if (!puedeGestionar) {
    if (!actual) return null;
    return (
      <Card>
        <CardContent className="space-y-1 p-4">
          <Eyebrow>Interlocutor activo</Eyebrow>
          <InterlocutorFlag nombre={actual.nombre} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <Eyebrow>Interlocutor activo</Eyebrow>
        {actual ? (
          <div className="space-y-1">
            <InterlocutorFlag nombre={actual.nombre} />
            {actual.motivo && <p className="text-xs text-muted-foreground">Motivo: {actual.motivo}</p>}
            {actual.at && (
              <p className="text-xs text-muted-foreground">
                Marcado el {new Date(actual.at).toLocaleDateString("es-ES")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Ahora mismo se puede hablar con cualquier propietario del edificio.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!actual && (
            <Select value={elegido} onValueChange={setElegido}>
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Elige un propietario" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {propietarios.map((p) => (
                  <SelectItem key={p.owner_id} value={p.owner_id}>{p.nombre ?? "(sin nombre)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="h-8 w-[200px] text-xs"
          />
          {actual ? (
            <Button size="sm" variant="outline" disabled={trabajando} onClick={quitar}>
              Quitar interlocutor
            </Button>
          ) : (
            <Button size="sm" disabled={trabajando || !elegido} onClick={marcar}>
              Marcar interlocutor activo
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

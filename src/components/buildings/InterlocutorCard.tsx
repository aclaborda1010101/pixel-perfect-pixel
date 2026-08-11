import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/common/Eyebrow";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { toast } from "@/hooks/use-toast";
import { InterlocutorFlag } from "@/components/buildings/InterlocutorFlag";

type Propietario = { owner_id: string; nombre: string | null };

/**
 * Marcar o quitar el interlocutor activo del edificio.
 * Pueden usarla administración, responsables de equipo y el comercial asignado.
 */
export function InterlocutorCard({
  buildingId,
  onChanged,
}: {
  buildingId: string;
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const { role } = useCurrentRole();
  const [propietarios, setPropietarios] = useState<Propietario[]>([]);
  const [actual, setActual] = useState<{ ownerId: string | null; nombre: string | null; motivo: string | null; at: string | null } | null>(null);
  const [elegido, setElegido] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [asignado, setAsignado] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = async () => {
    const [{ data: b }, { data: bo }, { data: asg }] = await Promise.all([
      (supabase.from("buildings") as any)
        .select("interlocutor_owner_id, interlocutor_motivo, interlocutor_marcado_at, owners:interlocutor_owner_id(nombre)")
        .eq("id", buildingId).maybeSingle(),
      (supabase.from("building_owners") as any)
        .select("owner_id, owners:owner_id(nombre)").eq("building_id", buildingId),
      user?.id
        ? (supabase.from("building_assignments") as any)
            .select("id").eq("building_id", buildingId).eq("user_id", user.id).eq("status", "active").maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setPropietarios(((bo ?? []) as any[]).map((r) => ({ owner_id: r.owner_id, nombre: r.owners?.nombre ?? null })));
    setAsignado(!!asg);
    const oid = (b as any)?.interlocutor_owner_id ?? null;
    setActual(oid ? {
      ownerId: oid,
      nombre: (b as any)?.owners?.nombre ?? null,
      motivo: (b as any)?.interlocutor_motivo ?? null,
      at: (b as any)?.interlocutor_marcado_at ?? null,
    } : null);
  };

  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [buildingId, user?.id]);

  const puedeGestionar = role === "admin" || role === "sales_manager" || asignado;

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

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Interlocutor activo</Eyebrow>
        <CardTitle>¿Con quién hablamos en este edificio?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
          <p className="text-sm text-muted-foreground">
            Ahora mismo se puede hablar con cualquier propietario del edificio.
          </p>
        )}

        {!puedeGestionar ? (
          <p className="text-xs text-muted-foreground">
            Solo pueden cambiarlo la dirección, el responsable de equipo o el comercial asignado a este edificio.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {!actual && (
              <Select value={elegido} onValueChange={setElegido}>
                <SelectTrigger className="h-9 w-[240px]">
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
              className="h-9 w-[240px]"
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
        )}
      </CardContent>
    </Card>
  );
}

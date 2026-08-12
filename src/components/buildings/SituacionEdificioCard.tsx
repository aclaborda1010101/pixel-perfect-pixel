import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { toast } from "@/hooks/use-toast";
import {
  SITUACIONES_EDIFICIO, situacionLabel, POSIBLE_INTERES_AYUDA,
} from "@/lib/situacionComercial";

/**
 * Situación comercial del edificio.
 * Solo dirección y responsables de equipo pueden cambiarla; el resto la ve informativa.
 */
export function SituacionEdificioCard({
  buildingId,
  situacion,
  onChanged,
}: {
  buildingId: string;
  situacion?: string | null;
  onChanged?: (nueva: string) => void;
}) {
  const { role } = useCurrentRole();
  const puedeEditar = role === "admin" || role === "sales_manager";
  const [valor, setValor] = useState<string>(situacion ?? "identificado");
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setValor(situacion ?? "identificado"); }, [situacion]);

  const guardar = async () => {
    setGuardando(true);
    const { error } = await (supabase.from("buildings") as any)
      .update({ estado: valor })
      .eq("id", buildingId);
    setGuardando(false);
    if (error) {
      toast({ title: "No se ha podido guardar la situación", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Situación actualizada: ${situacionLabel(valor)}` });
    onChanged?.(valor);
  };

  if (!puedeEditar) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Eyebrow>Situación comercial</Eyebrow>
          <Badge variant="outline">{situacionLabel(situacion ?? "identificado")}</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 p-4">
        <Eyebrow>Situación comercial</Eyebrow>
        <Select value={valor} onValueChange={setValor}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SITUACIONES_EDIFICIO.map((s) => (
              <SelectItem key={s} value={s}>{situacionLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={guardar} disabled={guardando || valor === (situacion ?? "identificado")}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          <strong>Posible interés:</strong> {POSIBLE_INTERES_AYUDA}
        </p>
      </CardContent>
    </Card>
  );
}

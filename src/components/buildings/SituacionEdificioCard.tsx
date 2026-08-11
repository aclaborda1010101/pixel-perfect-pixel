import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  SITUACIONES_EDIFICIO, situacionLabel, POSIBLE_INTERES_AYUDA,
} from "@/lib/situacionComercial";

/** Permite fijar o quitar la situación comercial del edificio (incluye "Posible interés"). */
export function SituacionEdificioCard({
  buildingId,
  situacion,
  onChanged,
}: {
  buildingId: string;
  situacion?: string | null;
  onChanged?: (nueva: string) => void;
}) {
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

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Situación comercial</Eyebrow>
        <CardTitle>¿En qué punto está este edificio?</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Select value={valor} onValueChange={setValor}>
          <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SITUACIONES_EDIFICIO.map((s) => (
              <SelectItem key={s} value={s}>{situacionLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={guardar} disabled={guardando || valor === (situacion ?? "identificado")}>
          {guardando ? "Guardando…" : "Guardar situación"}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          <strong>Posible interés:</strong> {POSIBLE_INTERES_AYUDA}
        </p>
      </CardContent>
    </Card>
  );
}

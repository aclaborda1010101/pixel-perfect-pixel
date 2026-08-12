import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useHorarioLaboral } from "@/hooks/useHorarioLaboral";
import { DIAS_SEMANA, ORDEN_DIAS, type HorarioLaboral } from "@/lib/horarioLaboral";

/** Horario de trabajo del equipo: fuera de él, una tarea no acumula retraso. */
export function HorarioLaboralCard({ puedeEditar }: { puedeEditar: boolean }) {
  const { horario, cargando, guardar } = useHorarioLaboral();
  const [borrador, setBorrador] = useState<HorarioLaboral>(horario);

  useEffect(() => { setBorrador(horario); }, [horario]);

  const cambiar = (i: number, campo: "activo" | "inicio" | "fin", valor: boolean | string) => {
    setBorrador((prev) => prev.map((d, j) => (j === i ? { ...d, [campo]: valor } as any : d)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Horario laboral</CardTitle>
        <CardDescription>
          Fuera de este horario una tarea no cuenta como retrasada: los fines de semana y las
          noches no suman retraso.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ORDEN_DIAS.map((i) => {
          const d = borrador[i];
          return (
            <div key={i} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-24 text-muted-foreground">{DIAS_SEMANA[i]}</span>
              <Switch
                checked={d.activo}
                disabled={!puedeEditar || cargando}
                onCheckedChange={(v) => cambiar(i, "activo", v)}
                aria-label={`Se trabaja el ${DIAS_SEMANA[i].toLowerCase()}`}
              />
              {d.activo ? (
                <>
                  <Input
                    type="time" value={d.inicio} disabled={!puedeEditar}
                    onChange={(e) => cambiar(i, "inicio", e.target.value)}
                    className="h-8 w-28" aria-label={`Hora de inicio del ${DIAS_SEMANA[i].toLowerCase()}`}
                  />
                  <span className="text-muted-foreground">a</span>
                  <Input
                    type="time" value={d.fin} disabled={!puedeEditar}
                    onChange={(e) => cambiar(i, "fin", e.target.value)}
                    className="h-8 w-28" aria-label={`Hora de fin del ${DIAS_SEMANA[i].toLowerCase()}`}
                  />
                </>
              ) : (
                <span className="text-muted-foreground">Sin trabajo</span>
              )}
            </div>
          );
        })}
        {puedeEditar && (
          <Button
            size="sm"
            disabled={guardar.isPending}
            onClick={() =>
              guardar.mutate(borrador, {
                onSuccess: () => toast({ title: "Horario guardado" }),
                onError: (e: any) =>
                  toast({ title: "No se ha podido guardar", description: e.message, variant: "destructive" }),
              })
            }
          >
            Guardar horario
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

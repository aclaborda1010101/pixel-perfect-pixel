import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import {
  ETIQUETA_TIPO,
  MODOS,
  TIPOS_TAREA,
  mezclaVacia,
  puedeCambiarModo,
  validarMezcla,
  type ModoCodigo,
  type TipoTarea,
} from "@/lib/modosGeneracion";

type Fila = { mode: ModoCodigo; etiqueta: string | null; mix: Record<string, number>; activo: boolean };

export function useModosGeneracion() {
  return useQuery({
    queryKey: ["modos-generacion"],
    queryFn: async (): Promise<Fila[]> => {
      const { data, error } = await supabase
        .from("work_modes")
        .select("mode,etiqueta,mix,activo")
        .eq("scope", "global");
      if (error) throw error;
      return (data ?? []) as unknown as Fila[];
    },
  });
}

export function ModosGeneracionCard() {
  const qc = useQueryClient();
  const { role } = useCurrentRole();
  const puede = puedeCambiarModo(role);
  const q = useModosGeneracion();
  const [seleccion, setSeleccion] = useState<ModoCodigo>("equilibrado");
  const [manual, setManual] = useState<Record<TipoTarea, number>>(mezclaVacia());
  const [guardando, setGuardando] = useState(false);

  const activo = q.data?.find((f) => f.activo)?.mode ?? null;
  useEffect(() => {
    if (activo) setSeleccion(activo);
    const m = q.data?.find((f) => f.mode === "manual")?.mix;
    if (m) setManual({ ...mezclaVacia(), ...(m as Record<TipoTarea, number>) });
  }, [activo, q.data]);

  const def = MODOS.find((m) => m.code === seleccion)!;
  const mezclaMostrada = def.editable ? manual : def.mezcla!;
  const validacion = useMemo(() => validarMezcla(mezclaMostrada), [mezclaMostrada]);

  const guardar = async () => {
    if (def.editable && !validacion.valida) {
      toast.error(validacion.errores[0]);
      return;
    }
    setGuardando(true);
    const { error } = await (supabase.rpc as any)("set_task_generation_mode", {
      p_mode: seleccion,
      p_mix: def.editable ? manual : null,
    });
    setGuardando(false);
    if (error) {
      toast.error(
        error.message.includes("no_autorizado")
          ? "No tienes permiso para cambiar el modo."
          : error.message,
      );
      return;
    }
    toast.success(`Modo activo: ${def.label}`);
    qc.invalidateQueries({ queryKey: ["modos-generacion"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cómo se reparten las tareas</CardTitle>
        <CardDescription>
          Elige el reparto de tareas del equipo. Se aplica a partir de la siguiente tarea generada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {MODOS.map((m) => (
            <Button
              key={m.code}
              size="sm"
              variant={seleccion === m.code ? "default" : "outline"}
              onClick={() => setSeleccion(m.code)}
            >
              {m.label}
              {activo === m.code && (
                <Badge className="ml-2" variant="secondary">
                  Activo
                </Badge>
              )}
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{def.descripcion}</p>

        <div className="grid gap-2 sm:grid-cols-2">
          {TIPOS_TAREA.map((t) => (
            <label key={t} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <span className="text-xs">{ETIQUETA_TIPO[t]}</span>
              {def.editable ? (
                <Input
                  className="h-8 w-20 text-right tabular-nums"
                  type="number"
                  min={0}
                  max={100}
                  disabled={!puede}
                  value={String(manual[t] ?? 0)}
                  onChange={(e) => {
                    const n = e.target.value === "" ? 0 : Number.parseInt(e.target.value, 10);
                    setManual((w) => ({ ...w, [t]: Number.isFinite(n) ? n : 0 }));
                  }}
                />
              ) : (
                <span className="text-sm font-semibold tabular-nums">{def.mezcla![t] ?? 0}%</span>
              )}
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-md border p-2 text-sm">
          <span>Total</span>
          <span
            className={
              validacion.total === 100
                ? "font-semibold tabular-nums"
                : "font-semibold tabular-nums text-destructive"
            }
          >
            {validacion.total}%
          </span>
        </div>

        {def.editable && validacion.errores.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-destructive">
            {validacion.errores.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        {!puede && (
          <p className="text-xs text-muted-foreground">
            Solo dirección y el responsable de ventas pueden cambiar el reparto.
          </p>
        )}

        <Button
          size="sm"
          disabled={!puede || guardando || (def.editable && !validacion.valida)}
          onClick={guardar}
        >
          Activar este reparto
        </Button>
      </CardContent>
    </Card>
  );
}

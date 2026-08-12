import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CLAVE_HORARIO,
  HORARIO_POR_DEFECTO,
  normalizarHorario,
  type HorarioLaboral,
} from "@/lib/horarioLaboral";

/** Horario laboral del equipo, guardado en los ajustes de la aplicación. */
export function useHorarioLaboral() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["horario-laboral"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<HorarioLaboral> => {
      const { data } = await (supabase.from("app_settings") as any)
        .select("value").eq("key", CLAVE_HORARIO).maybeSingle();
      const v = (data as any)?.value;
      return normalizarHorario(v?.dias ?? v);
    },
  });

  const guardar = useMutation({
    mutationFn: async (horario: HorarioLaboral) => {
      const { error } = await (supabase.from("app_settings") as any).upsert(
        { key: CLAVE_HORARIO, value: { dias: horario }, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["horario-laboral"] }); },
  });

  return { horario: q.data ?? HORARIO_POR_DEFECTO, cargando: q.isLoading, guardar };
}

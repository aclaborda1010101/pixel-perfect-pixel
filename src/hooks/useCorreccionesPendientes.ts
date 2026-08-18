import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { esCorreccionDeDatos } from "@/lib/correcciones";

export type ResumenFila = { guarda: number; estado: string; total: number };

/** Resumen de correcciones por tipo y estado (solo admin / responsable de ventas). */
export function useCorreccionesResumen() {
  const { role } = useCurrentRole();
  const habilitado = role === "admin" || role === "sales_manager";
  return useQuery({
    queryKey: ["correcciones-resumen"],
    enabled: habilitado,
    staleTime: 30_000,
    queryFn: async (): Promise<ResumenFila[]> => {
      const { data, error } = await (supabase.rpc as any)("correcciones_resumen");
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[]).map((r) => ({
        guarda: Number(r.guarda),
        estado: String(r.estado),
        total: Number(r.total),
      }));
    },
  });
}

/** Número total de correcciones de DATOS pendientes de revisar (excluye trabajo comercial). */
export function useCorreccionesPendientes() {
  const q = useCorreccionesResumen();
  const total = (q.data ?? [])
    .filter((r) => r.estado === "pendiente" && esCorreccionDeDatos(r.guarda))
    .reduce((a, r) => a + r.total, 0);
  return { total, loading: q.isLoading };
}

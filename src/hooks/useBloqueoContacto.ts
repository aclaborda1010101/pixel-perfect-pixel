import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * ¿Está este propietario bloqueado porque su edificio tiene interlocutor activo?
 * Se pregunta al servidor para que coincida con la regla real.
 */
export function useBloqueoContacto(ownerId?: string | null, buildingId?: string | null) {
  const q = useQuery({
    queryKey: ["bloqueo_contacto", ownerId ?? "", buildingId ?? ""],
    enabled: !!ownerId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("owner_bloqueado_por_interlocutor", {
        p_owner_id: ownerId,
        p_building_id: buildingId ?? null,
      });
      if (error) return false;
      return !!data;
    },
  });
  return { bloqueado: q.data === true, loading: q.isLoading };
}
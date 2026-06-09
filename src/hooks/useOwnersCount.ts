import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Conteo único de propietarios usando la RPC count_distinct_owners (deduplica por nombre normalizado / NIF / email). */
export function useOwnersCount(buildingId?: string | null) {
  return useQuery({
    queryKey: ["owners-count", buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("count_distinct_owners" as any, { p_building_id: buildingId });
      if (error) throw error;
      return Number(data ?? 0);
    },
    staleTime: 60_000,
  });
}

/** Conteo único en lote. Devuelve mapa { building_id: n }. */
export function useOwnersCountBatch(buildingIds: string[]) {
  const key = [...buildingIds].sort().join(",");
  return useQuery({
    queryKey: ["owners-count-batch", key],
    enabled: buildingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("count_distinct_owners_batch" as any, { p_building_ids: buildingIds });
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as Array<{ building_id: string; n: number }>) {
        map[row.building_id] = Number(row.n ?? 0);
      }
      return map;
    },
    staleTime: 60_000,
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InterlocutorInfo = { ownerId: string; nombre: string | null; motivo: string | null };

/** Mapa edificio -> interlocutor activo (si lo hay). */
export function useInterlocutores(buildingIds: string[]) {
  const ids = Array.from(new Set(buildingIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["interlocutores", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, InterlocutorInfo>> => {
      const out: Record<string, InterlocutorInfo> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await (supabase.from("buildings") as any)
          .select("id, interlocutor_owner_id, interlocutor_motivo, owners:interlocutor_owner_id(nombre)")
          .not("interlocutor_owner_id", "is", null)
          .in("id", ids.slice(i, i + 200));
        for (const r of (data ?? []) as any[]) {
          out[r.id] = {
            ownerId: r.interlocutor_owner_id,
            nombre: r.owners?.nombre ?? null,
            motivo: r.interlocutor_motivo ?? null,
          };
        }
      }
      return out;
    },
  });
}

/** Conjunto de edificios que ahora mismo tienen un interlocutor activo. */
export function useEdificiosConInterlocutor() {
  return useQuery({
    queryKey: ["edificios_con_interlocutor"],
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data } = await (supabase.from("buildings") as any)
        .select("id")
        .not("interlocutor_owner_id", "is", null);
      return ((data ?? []) as any[]).map((r) => String(r.id));
    },
  });
}

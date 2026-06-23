import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useBuildingProcessing(buildingId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["building_processing_status", buildingId],
    enabled: !!buildingId && enabled,
    refetchInterval: (q) => {
      const d = q.state.data as any;
      return d?.status === "running" ? 2000 : false;
    },
    queryFn: async () => {
      const { data } = await (supabase.from("building_processing_status" as any) as any)
        .select("*").eq("building_id", buildingId!).maybeSingle();
      return data as any;
    },
  });
}

export function useBuildingAnalysis(buildingId: string | undefined) {
  return useQuery({
    queryKey: ["building_analysis", buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const [{ data: analysis }, { data: imgs }, { data: cat }] = await Promise.all([
        (supabase.from("building_analysis" as any) as any).select("*").eq("building_id", buildingId!).maybeSingle(),
        (supabase.from("building_imagery" as any) as any).select("*").eq("building_id", buildingId!),
        (supabase.from("catastro_data" as any) as any).select("*").eq("building_id", buildingId!).maybeSingle(),
      ]);
      // Solo última generación por source: descarta filas con fetched_at
      // anterior al máximo de su source (evita ver fotos viejas tras reanalizar).
      const all = (imgs ?? []) as any[];
      const latestBySource = new Map<string, number>();
      for (const r of all) {
        const t = r?.fetched_at ? Date.parse(r.fetched_at) : 0;
        const cur = latestBySource.get(r.source) ?? 0;
        if (t > cur) latestBySource.set(r.source, t);
      }
      const filtered = all.filter((r) => {
        const t = r?.fetched_at ? Date.parse(r.fetched_at) : 0;
        const max = latestBySource.get(r.source) ?? 0;
        // tolerancia de 5s por si varias fotos del mismo source llegaron en el mismo batch
        return max - t < 5000;
      });
      return { analysis: analysis as any, imgs: filtered, catastro: cat as any };
    },
  });
}
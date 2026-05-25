import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useScoringV2Flag() {
  return useQuery({
    queryKey: ["app_settings", "scoring_v2_enabled"],
    queryFn: async () => {
      const { data } = await (supabase.from("app_settings" as any) as any)
        .select("value").eq("key", "scoring_v2_enabled").maybeSingle();
      return data?.value === true || data?.value === "true";
    },
    staleTime: 60_000,
  });
}

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
      return { analysis: analysis as any, imgs: (imgs ?? []) as any[], catastro: cat as any };
    },
  });
}
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  periodRange,
  type PeriodKey,
  type SalesManagerDashboard,
} from "@/lib/salesManagerMetrics";

/** Panel de gestor: SÓLO agregados vía RPC. Cero consultas directas a building_tasks. */
export function useSalesManagerDashboard(period: PeriodKey) {
  const { from, to } = periodRange(period);
  return useQuery({
    queryKey: ["sales-manager-dashboard", from.toISOString(), to.toISOString()],
    queryFn: async (): Promise<SalesManagerDashboard> => {
      const { data, error } = await (supabase.rpc as any)("get_sales_manager_dashboard", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data ?? { from: from.toISOString(), to: to.toISOString(), generated_at: "", rows: [] }) as SalesManagerDashboard;
    },
    retry: 1,
  });
}

export function useSalesTaskModeConfig() {
  return useQuery({
    queryKey: ["sales-task-mode-config"],
    queryFn: async (): Promise<any> => {
      const { data, error } = await (supabase.rpc as any)("get_sales_task_mode_config");
      if (error) throw new Error(error.message);
      return data ?? { groups: [], modes: [], active: null, overrides: [], audit: [] };
    },
    retry: 1,
  });
}

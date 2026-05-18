import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AppRole = "admin" | "captacion" | "comercial_zona" | "prevalificacion" | "viewer" | null;

/** Devuelve el rol principal del usuario actual (cacheado 5 min). */
export function useCurrentRole() {
  const { user, loading: authLoading } = useAuth();
  const q = useQuery({
    queryKey: ["currentUserRole", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AppRole> => {
      const { data, error } = await (supabase.rpc as any)("current_user_role");
      if (error) return null;
      return (data as AppRole) ?? "viewer";
    },
  });
  return {
    role: (q.data ?? null) as AppRole,
    loading: authLoading || q.isLoading,
    isAdmin: q.data === "admin",
    isComercial: q.data === "comercial_zona",
  };
}
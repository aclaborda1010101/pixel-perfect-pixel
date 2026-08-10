import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Lee profiles.must_change_password del usuario actual. Si la columna no existe, devuelve false. */
export function useMustChangePassword() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["mustChangePassword", user?.id ?? "anon"],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await (supabase.from("profiles") as any)
        .select("must_change_password")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) return false;
      return Boolean(data?.must_change_password);
    },
  });
  return { mustChange: q.data === true, loading: !!user && q.isLoading };
}

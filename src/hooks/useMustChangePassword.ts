import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** Lee profiles.must_change_password. Falla cerrado: si la lectura falla, se propaga el error. */
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
      if (error) throw new Error(error.message);
      return Boolean(data?.must_change_password);
    },
    retry: 1,
  });
  return {
    mustChange: q.data === true,
    loading: !!user && q.isLoading,
    error: (q.error as Error | null) ?? null,
    refetch: q.refetch,
  };
}

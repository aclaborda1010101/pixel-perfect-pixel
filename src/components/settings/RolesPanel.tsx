import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { AppRole } from "@/hooks/useCurrentRole";

const ROLES: Array<{ value: Exclude<AppRole, null>; label: string; color: "info" | "gold" | "outline" | "destructive" }> = [
  { value: "admin", label: "Admin", color: "destructive" },
  { value: "comercial_zona", label: "Comercial Zona", color: "gold" },
  { value: "captacion", label: "Captación", color: "info" },
  { value: "prevalificacion", label: "Prevalificación", color: "info" },
  { value: "viewer", label: "Viewer", color: "outline" },
];

type ProfileRow = { id: string; email: string | null; full_name: string | null };
type RoleRow = { user_id: string; role: Exclude<AppRole, null> };

export function RolesPanel() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["settings:roles"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id,email,full_name").order("email"),
        supabase.from("user_roles").select("user_id,role"),
      ]);
      const rolesByUser = new Map<string, Exclude<AppRole, null>>();
      (roles as RoleRow[] | null)?.forEach((r) => rolesByUser.set(r.user_id, r.role));
      return {
        profiles: (profiles ?? []) as ProfileRow[],
        rolesByUser,
      };
    },
  });

  async function setRole(userId: string, role: Exclude<AppRole, null>) {
    setBusy(userId);
    try {
      // borrar todos los roles existentes del user y poner el nuevo
      const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (insErr) throw insErr;
      toast.success(`Rol actualizado: ${role}`);
      await qc.invalidateQueries({ queryKey: ["settings:roles"] });
      await qc.invalidateQueries({ queryKey: ["currentUserRole"] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar el rol");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><ShieldCheck className="mr-1 inline h-3 w-3" /> Roles de usuario</Eyebrow>
        <CardTitle>Asignación de roles</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border-faint">
          {(data?.profiles ?? []).map((p) => {
            const current = data?.rolesByUser.get(p.id) ?? "viewer";
            return (
              <li key={p.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{p.full_name || p.email || p.id.slice(0, 8)}</div>
                  <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{p.email ?? "—"}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ROLES.find((r) => r.value === current)?.color ?? "outline"}>
                    {ROLES.find((r) => r.value === current)?.label ?? current}
                  </Badge>
                  <div className="flex flex-wrap gap-1">
                    {ROLES.map((r) => (
                      <Button
                        key={r.value}
                        size="sm"
                        variant={current === r.value ? "gold" : "outline"}
                        disabled={busy === p.id || current === r.value}
                        onClick={() => setRole(p.id, r.value)}
                      >
                        {r.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
          {(data?.profiles ?? []).length === 0 && (
            <li className="px-5 py-6 text-sm text-muted-foreground">Sin usuarios registrados.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
import { PageHeader } from "@/components/common/PageHeader";
import { RolesPanel } from "@/components/settings/RolesPanel";
import { BuildingAssignmentsPanel } from "@/components/settings/BuildingAssignmentsPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export default function AdminEquipo() {
  const { isAdmin, loading } = useCurrentRole();
  const [creating, setCreating] = useState(false);
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;

  const handleCreateWhatsappUser = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin_create_whatsapp_user");
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Usuario WhatsApp listo: ${(data as any)?.email ?? "whatsapp@afflux.es"}`);
    } catch (e: any) {
      toast.error(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Equipo" title="Equipo" subtitle="Roles y asignaciones de edificios" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuario WhatsApp Bot</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">
            Crea / resetea el usuario <code>whatsapp@afflux.es</code> con rol <code>whatsapp</code>. Solo puede acceder al panel <code>/whatsapp</code>.
          </div>
          <Button onClick={handleCreateWhatsappUser} disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Crear / resetear usuario
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <RolesPanel />
        <BuildingAssignmentsPanel />
      </div>
    </div>
  );
}
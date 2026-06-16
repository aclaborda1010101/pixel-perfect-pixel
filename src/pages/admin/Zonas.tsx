import { PageHeader } from "@/components/common/PageHeader";
import { SubZonasPanel } from "@/components/settings/SubZonasPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";

export default function AdminZonas() {
  const { isAdmin, loading } = useCurrentRole();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Zonas" title="Sub-zonas y calles" subtitle="Configuración geográfica" />
      <div className="grid gap-4 md:grid-cols-2">
        <SubZonasPanel />
      </div>
    </div>
  );
}
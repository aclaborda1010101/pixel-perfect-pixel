import { PageHeader } from "@/components/common/PageHeader";
import { JobsManualPanel } from "@/components/settings/JobsManualPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";

export default function AdminOps() {
  const { isAdmin, loading } = useCurrentRole();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Ops"
        title="Jobs manuales"
        subtitle="Ruta oculta. Sólo para operaciones puntuales bajo demanda."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <JobsManualPanel />
      </div>
    </div>
  );
}
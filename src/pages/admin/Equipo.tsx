import { PageHeader } from "@/components/common/PageHeader";
import { RolesPanel } from "@/components/settings/RolesPanel";
import { BuildingAssignmentsPanel } from "@/components/settings/BuildingAssignmentsPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";

export default function AdminEquipo() {
  const { isAdmin, loading } = useCurrentRole();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · Equipo" title="Equipo" subtitle="Roles y asignaciones de edificios" />
      <div className="grid gap-4 md:grid-cols-2">
        <RolesPanel />
        <BuildingAssignmentsPanel />
      </div>
    </div>
  );
}
import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlaybookPanel } from "@/components/settings/PlaybookPanel";
import { KnowledgeBasePanel } from "@/components/settings/KnowledgeBasePanel";
import { AprendizajePanel } from "@/components/settings/AprendizajePanel";
import { EnrichmentConfigPanel } from "@/components/settings/EnrichmentConfigPanel";
import { AnalisisIAPanel } from "@/components/settings/AnalisisIAPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";

export default function AdminIA() {
  const { isAdmin, loading } = useCurrentRole();
  const [tab, setTab] = useState("playbook");
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Admin · IA" title="Configuración de IA" subtitle="Playbook, conocimiento, aprendizaje y enriquecimiento" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="playbook">Playbook</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="aprendizaje">Aprendizaje</TabsTrigger>
          <TabsTrigger value="enrichment">Enriquecimiento</TabsTrigger>
          <TabsTrigger value="analisis">Análisis</TabsTrigger>
        </TabsList>
        <TabsContent value="playbook" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><PlaybookPanel /></div></TabsContent>
        <TabsContent value="knowledge" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><KnowledgeBasePanel /></div></TabsContent>
        <TabsContent value="aprendizaje" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><AprendizajePanel /></div></TabsContent>
        <TabsContent value="enrichment" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><EnrichmentConfigPanel /></div></TabsContent>
        <TabsContent value="analisis" className="mt-4"><div className="grid gap-4 md:grid-cols-2"><AnalisisIAPanel /></div></TabsContent>
      </Tabs>
    </div>
  );
}
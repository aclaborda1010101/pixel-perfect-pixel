import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PreCallBrief } from "@/components/agents/PreCallBrief";
import { AnalyzeNote } from "@/components/agents/AnalyzeNote";
import { CatalogRoleButton } from "@/components/agents/CatalogRoleButton";
import { RagSearch } from "@/components/agents/RagSearch";
import { WhatsappComposer } from "@/components/comms/WhatsappComposer";
import { SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";

type Owner = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  rol: string;
  subrole: string;
  rol_confianza: number | null;
  rol_justificacion: string | null;
  consentimiento: boolean;
  notas_breves: string | null;
};

export default function OwnerDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [o, c, n, a, as, bo] = await Promise.all([
        supabase.from("owners").select("*").eq("id", id).maybeSingle(),
        supabase.from("calls").select("*").eq("owner_id", id).order("fecha", { ascending: false }),
        supabase.from("notes").select("*").eq("owner_id", id).order("created_at", { ascending: false }),
        supabase.from("next_actions").select("*").eq("owner_id", id).order("created_at", { ascending: false }),
        supabase.from("assets").select("*").eq("owner_id", id),
        supabase.from("building_owners").select("building_id, cuota, subrole, buildings:building_id(id, direccion, ciudad)").eq("owner_id", id),
      ]);
      setOwner(o.data as Owner);
      setCalls(c.data ?? []);
      setNotes(n.data ?? []);
      setActions(a.data ?? []);
      setAssets(as.data ?? []);
      setBuildings(bo.data ?? []);
    })();
  }, [id]);

  if (!owner) {
    return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  }

  return (
    <div>
      <Crumbs items={[{ label: "Propietarios", to: "/propietarios" }, { label: owner.nombre }]} />
      <PageHeader
        title={owner.nombre}
        subtitle={owner.email ?? owner.telefono ?? ""}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              {owner.rol}
              {owner.rol_confianza != null && (
                <span className="text-xs text-muted-foreground">
                  · {(owner.rol_confianza * 100).toFixed(0)}%
                </span>
              )}
            </Badge>
            {owner.subrole && owner.subrole !== "ninguno" && (
              <Badge variant="secondary">{SUBROLE_LABEL[owner.subrole] ?? owner.subrole}</Badge>
            )}
          </div>
        }
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="calls">Llamadas ({calls.length})</TabsTrigger>
          <TabsTrigger value="notes">Notas ({notes.length})</TabsTrigger>
          <TabsTrigger value="assets">Activos ({assets.length})</TabsTrigger>
          <TabsTrigger value="buildings">Edificios ({buildings.length})</TabsTrigger>
          <TabsTrigger value="actions">Acciones ({actions.length})</TabsTrigger>
          <TabsTrigger value="ai">
            <Sparkles className="mr-1 h-3 w-3" /> IA
          </TabsTrigger>
          <TabsTrigger value="comms">Comms</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Datos</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm md:grid-cols-2">
              <Field label="Email" value={owner.email} />
              <Field label="Teléfono" value={owner.telefono} />
              <Field label="Consentimiento" value={owner.consentimiento ? "Sí" : "No"} />
              <Field label="Justificación rol" value={owner.rol_justificacion} />
              <div className="md:col-span-2">
                <Field label="Notas breves" value={owner.notas_breves} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <SimpleList items={calls.map((c) => ({
            primary: c.resumen ?? "(sin resumen)",
            secondary: `${new Date(c.fecha).toLocaleString()} · ${c.direccion}`,
          }))} />
        </TabsContent>
        <TabsContent value="notes">
          <SimpleList items={notes.map((n) => ({
            primary: n.texto,
            secondary: new Date(n.created_at).toLocaleString(),
          }))} />
        </TabsContent>
        <TabsContent value="assets">
          <SimpleList items={assets.map((a) => ({
            primary: `${a.tipo} · ${a.ubicacion}`,
            secondary: `${a.estado} · ${a.superficie_m2 ?? "?"} m²`,
          }))} />
        </TabsContent>
        <TabsContent value="buildings">
          {buildings.length === 0 ? (
            <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No participa en ningún edificio</CardContent></Card>
          ) : (
            <Card><ul className="divide-y divide-border">
              {buildings.map((b: any) => (
                <li key={b.building_id}>
                  <Link to={`/edificios/${b.building_id}`} className="flex items-center justify-between px-4 py-3 hover:bg-accent/30">
                    <div>
                      <div className="text-sm font-medium">{b.buildings?.direccion}</div>
                      <div className="text-xs text-muted-foreground">{b.buildings?.ciudad}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.cuota != null && <Badge variant="secondary">{b.cuota}%</Badge>}
                      <Badge variant="outline">{SUBROLE_LABEL[b.subrole] ?? b.subrole}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul></Card>
          )}
        </TabsContent>
        <TabsContent value="actions">
          <SimpleList items={actions.map((a) => ({
            primary: a.titulo,
            secondary: `${a.estado} · ${a.vencimiento ?? "—"}`,
          }))} />
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <CatalogRoleButton ownerId={owner.id} onDone={() => window.location.reload()} />
          <PreCallBrief ownerId={owner.id} />
          <AnalyzeNote ownerId={owner.id} />
          <RagSearch scopeType="owner" scopeId={owner.id} />
        </TabsContent>

        <TabsContent value="comms">
          <WhatsappComposer ownerId={owner.id} ownerName={owner.nombre} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1">{value || "—"}</div>
    </div>
  );
}

function SimpleList({ items }: { items: { primary: string; secondary: string }[] }) {
  if (items.length === 0) {
    return <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">Sin registros</CardContent></Card>;
  }
  return (
    <Card>
      <ul className="divide-y divide-border">
        {items.map((it, i) => (
          <li key={i} className="px-4 py-3">
            <div className="text-sm">{it.primary}</div>
            <div className="text-xs text-muted-foreground">{it.secondary}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
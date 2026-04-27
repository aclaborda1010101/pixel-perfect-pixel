import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
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
    <div className="space-y-6">
      <Crumbs items={[{ label: "Propietarios", to: "/propietarios" }, { label: owner.nombre }]} />
      <PageHeader
        eyebrow="Propietario · Ficha"
        title={owner.nombre}
        subtitle={owner.email ?? owner.telefono ?? ""}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="info" className="gap-1">
              {owner.rol}
              {owner.rol_confianza != null && (
                <span className="ml-1 font-mono text-[10px] opacity-80">
                  · {(owner.rol_confianza * 100).toFixed(0)}%
                </span>
              )}
            </Badge>
            {owner.subrole && owner.subrole !== "ninguno" && (
              <Badge variant="outline">{SUBROLE_LABEL[owner.subrole] ?? owner.subrole}</Badge>
            )}
            {owner.consentimiento && <Badge variant="success">Consentimiento</Badge>}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card><div className="p-5"><Eyebrow>Llamadas</Eyebrow><div className="mt-2"><MetricValue size="lg">{calls.length}</MetricValue></div></div></Card>
            <Card><div className="p-5"><Eyebrow>Notas</Eyebrow><div className="mt-2"><MetricValue size="lg">{notes.length}</MetricValue></div></div></Card>
            <Card><div className="p-5"><Eyebrow>Activos</Eyebrow><div className="mt-2"><MetricValue size="lg">{assets.length}</MetricValue></div></div></Card>
            <Card><div className="p-5"><Eyebrow>Acciones</Eyebrow><div className="mt-2"><MetricValue size="lg">{actions.length}</MetricValue></div></div></Card>
          </div>

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
                <CardHeader>
                  <Eyebrow>Datos del contacto</Eyebrow>
                  <CardTitle>Ficha</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm md:grid-cols-2">
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
                <EmptyState title="No participa en ningún edificio" description="Vincula este propietario a un edificio desde la ficha del edificio." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {buildings.map((b: any) => (
                      <li key={b.building_id}>
                        <Link to={`/edificios/${b.building_id}`} className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div>
                            <div className="text-sm font-medium text-foreground">{b.buildings?.direccion}</div>
                            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{b.buildings?.ciudad}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {b.cuota != null && <Badge variant="gold">{b.cuota}%</Badge>}
                            <Badge variant="outline">{SUBROLE_LABEL[b.subrole] ?? b.subrole}</Badge>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
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

        {/* Timeline lateral */}
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <Eyebrow>Actividad reciente</Eyebrow>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {calls.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin actividad registrada todavía.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-border-faint pl-4">
                  {calls.slice(0, 6).map((c) => (
                    <li key={c.id} className="relative">
                      <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full border border-gold bg-background" />
                      <Link to={`/llamadas/${c.id}`} className="block hover:text-foreground">
                        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                          {new Date(c.fecha).toLocaleDateString()}
                        </div>
                        <div className="mt-0.5 text-xs text-foreground line-clamp-2">{c.resumen ?? "(sin resumen)"}</div>
                        <div className="mt-1.5">
                          <StatusBadge status={c.resumen ? "analyzed" : "no_summary"} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 text-foreground">{value || "—"}</div>
    </div>
  );
}

function SimpleList({ items }: { items: { primary: string; secondary: string }[] }) {
  if (items.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Sin registros</CardContent></Card>;
  }
  return (
    <Card>
      <ul className="divide-y divide-border-faint">
        {items.map((it, i) => (
          <li key={i} className="px-4 py-3">
            <div className="text-sm text-foreground">{it.primary}</div>
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{it.secondary}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

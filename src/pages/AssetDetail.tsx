import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PhoneCall, ListChecks, Users } from "lucide-react";
import { SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";

export default function AssetDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [asset, setAsset] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [building, setBuilding] = useState<any>(null);
  const [buildingOwners, setBuildingOwners] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: a } = await supabase.from("assets").select("*").eq("id", id).maybeSingle();
      setAsset(a);
      if (a?.owner_id) {
        const [{ data: o }, { data: c }, { data: ac }] = await Promise.all([
          supabase.from("owners").select("*").eq("id", a.owner_id).maybeSingle(),
          supabase.from("calls").select("id, fecha, resumen, direccion").eq("owner_id", a.owner_id).order("fecha", { ascending: false }),
          supabase.from("next_actions").select("*").eq("asset_id", id),
        ]);
        setOwner(o); setCalls(c ?? []); setActions(ac ?? []);
      }
      if (a?.building_id) {
        const { data: b } = await supabase.from("buildings").select("*").eq("id", a.building_id).maybeSingle();
        setBuilding(b);
        const { data: bo } = await supabase
          .from("building_owners")
          .select("owner_id, cuota, subrole, owners:owner_id(id, nombre, rol, email, telefono)")
          .eq("building_id", a.building_id);
        setBuildingOwners(bo ?? []);
      }
    })();
  }, [id]);

  if (!asset) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="w-full min-w-0 space-y-6">
      <Crumbs items={[{ label: t.nav.assets, to: "/activos" }, { label: `${asset.tipo} · ${asset.ubicacion}` }]} />
      <PageHeader
        eyebrow={`Activo · ${asset.tipo}`}
        title={`${asset.tipo} · ${asset.ubicacion}`}
        subtitle={`${asset.ciudad ?? ""} · ${asset.superficie_m2 ?? "?"} m²`}
        actions={<Badge variant="gold">{asset.estado}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <Card><div className="p-4 md:p-5"><Eyebrow>Superficie</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="m²">{asset.superficie_m2 ?? "—"}</MetricValue></div></div></Card>
            <Card><div className="p-4 md:p-5"><Eyebrow>Valoración</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="€">{asset.valoracion_estimada ? Number(asset.valoracion_estimada).toLocaleString() : "—"}</MetricValue></div></div></Card>
            <Card><div className="p-4 md:p-5"><Eyebrow>Acciones abiertas</Eyebrow><div className="mt-2"><MetricValue size="lg">{actions.length}</MetricValue></div></div></Card>
          </div>

          <Tabs defaultValue="owners">
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <TabsList className="w-max md:w-auto">
              <TabsTrigger value="owners">{t.assetDetail.ownersTab}</TabsTrigger>
              <TabsTrigger value="calls">{t.assetDetail.callsTab} ({calls.length})</TabsTrigger>
              <TabsTrigger value="actions">{t.assetDetail.actionsTab} ({actions.length})</TabsTrigger>
              <TabsTrigger value="building">{t.assetDetail.buildingTab}</TabsTrigger>
            </TabsList>
            </div>
            <TabsContent value="owners">
              <Card>
                <CardContent className="space-y-4 p-5 text-sm">
                  {owner && (
                    <div>
                      <Eyebrow className="mb-2">Propietario principal (contacto)</Eyebrow>
                      <Link to={`/propietarios/${owner.id}`} className="flex items-center justify-between gap-3 rounded-[6px] border border-border bg-surface-1/30 p-3 transition-colors hover:border-gold/50 hover:bg-surface-1/60">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">{owner.nombre}</div>
                          <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{owner.email ?? owner.telefono ?? "—"}</div>
                        </div>
                        <Badge variant="info" className="shrink-0">{owner.rol}</Badge>
                      </Link>
                    </div>
                  )}
                  {building && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <Eyebrow>
                            {building.division_horizontal
                              ? "Propietarios del edificio (% real por vivienda)"
                              : "Todos los propietarios del edificio"}
                          </Eyebrow>
                        <Link to={`/edificios/${building.id}`} className="font-mono text-[10px] uppercase tracking-eyebrow text-gold hover:underline">Gestionar →</Link>
                      </div>
                      {buildingOwners.length === 0 ? (
                        <div className="rounded-[6px] border border-dashed border-border-faint p-3 text-xs text-muted-foreground">
                          No hay propietarios asociados al edificio. Añádelos en la ficha del edificio.
                        </div>
                      ) : (
                        <ul className="divide-y divide-border-faint rounded-[6px] border border-border-faint">
                          {buildingOwners.map((r: any) => (
                            <li key={r.owner_id}>
                              <Link to={`/propietarios/${r.owner_id}`} className="flex flex-col items-start gap-2 px-3 py-2 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium text-foreground">{r.owners?.nombre}</div>
                                  <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{r.owners?.email ?? r.owners?.telefono ?? "—"}</div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  {building.division_horizontal ? (
                                    <Badge variant="outline" title="División horizontal: ver % por finca en la ficha del edificio">DH</Badge>
                                  ) : (
                                    r.cuota != null && <Badge variant="gold">{r.cuota}%</Badge>
                                  )}
                                  <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                                </div>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {!owner && !building && (
                    <EmptyState icon={Users} title="Sin propietario asignado" description="Asocia un propietario o un edificio para empezar a operar este activo." />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="calls">
              {calls.length === 0 ? (
                <EmptyState icon={PhoneCall} title="Aún no hay llamadas" description="Las llamadas analizadas con el propietario aparecerán aquí." ctaLabel="Analizar una llamada" ctaTo="/analizar-llamada" />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <Link to={`/llamadas/${c.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div className="text-sm text-foreground">{c.resumen ?? "(sin resumen)"}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{new Date(c.fecha).toLocaleString()} · {c.direccion}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="actions">
              {actions.length === 0 ? (
                <EmptyState icon={ListChecks} title="Sin acciones abiertas" description="Crea acciones desde el análisis de una llamada o desde el propietario." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {actions.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="text-foreground">{a.titulo}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{a.estado} · {a.vencimiento ?? "—"}</div>
                        </div>
                        <StatusBadge status={a.estado === "pendiente" ? "action_pending" : "done"} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>
            <TabsContent value="building">
              <Card>
                <CardContent className="p-5 text-sm">
                  {building ? (
                    <div className="space-y-1">
                      <Eyebrow>Edificio asociado</Eyebrow>
                      <div className="mt-1 font-editorial text-lg tracking-notarial text-foreground break-words">{building.direccion}</div>
                      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{building.ciudad} · {building.codigo_postal ?? "—"}</div>
                      <div className="mt-2 text-xs text-muted-foreground">Propietarios: {building.numero_propietarios ?? "?"} · DH: {building.division_horizontal ? "Sí" : "No"}</div>
                    </div>
                  ) : <div className="text-muted-foreground">Sin edificio asociado</div>}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Timeline lateral */}
        <aside className="min-w-0 space-y-4">
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

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
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
    <div>
      <Crumbs items={[{ label: t.nav.assets, to: "/activos" }, { label: `${asset.tipo} · ${asset.ubicacion}` }]} />
      <PageHeader
        title={`${asset.tipo} · ${asset.ubicacion}`}
        subtitle={`${asset.ciudad ?? ""} · ${asset.superficie_m2 ?? "?"} m²`}
        actions={<Badge variant="outline">{asset.estado}</Badge>}
      />
      <Tabs defaultValue="owners">
        <TabsList>
          <TabsTrigger value="owners">{t.assetDetail.ownersTab}</TabsTrigger>
          <TabsTrigger value="calls">{t.assetDetail.callsTab} ({calls.length})</TabsTrigger>
          <TabsTrigger value="actions">{t.assetDetail.actionsTab} ({actions.length})</TabsTrigger>
          <TabsTrigger value="building">{t.assetDetail.buildingTab}</TabsTrigger>
        </TabsList>
        <TabsContent value="owners">
          <Card><CardContent className="space-y-3 p-4 text-sm">
            {owner && (
              <div>
                <div className="mb-1 text-xs uppercase text-muted-foreground">Propietario principal (contacto)</div>
                <Link to={`/propietarios/${owner.id}`} className="flex items-center justify-between rounded border border-border p-3 hover:bg-accent/30">
                  <div>
                    <div className="font-medium">{owner.nombre}</div>
                    <div className="text-xs text-muted-foreground">{owner.email ?? owner.telefono ?? "—"}</div>
                  </div>
                  <Badge variant="outline">{owner.rol}</Badge>
                </Link>
              </div>
            )}
            {building && (
              <div>
                <div className="mb-1 flex items-center justify-between text-xs uppercase text-muted-foreground">
                  <span>Todos los propietarios del edificio</span>
                  <Link to={`/edificios/${building.id}`} className="normal-case text-primary hover:underline">Gestionar →</Link>
                </div>
                {buildingOwners.length === 0 ? (
                  <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground">
                    No hay propietarios asociados al edificio. Añádelos en la ficha del edificio.
                  </div>
                ) : (
                  <ul className="divide-y divide-border rounded border border-border">
                    {buildingOwners.map((r: any) => (
                      <li key={r.owner_id}>
                        <Link to={`/propietarios/${r.owner_id}`} className="flex items-center justify-between px-3 py-2 hover:bg-accent/30">
                          <div>
                            <div className="font-medium">{r.owners?.nombre}</div>
                            <div className="text-xs text-muted-foreground">{r.owners?.email ?? r.owners?.telefono ?? "—"}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {r.cuota != null && <Badge variant="secondary">{r.cuota}%</Badge>}
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
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="calls">
          {calls.length === 0 ? (
            <EmptyState icon={PhoneCall} title="Aún no hay llamadas" description="Las llamadas analizadas con el propietario aparecerán aquí." ctaLabel="Analizar una llamada" ctaTo="/analizar-llamada" />
          ) : (
          <Card><ul className="divide-y divide-border">
            {calls.map((c) => (
              <li key={c.id}>
                <Link to={`/llamadas/${c.id}`} className="block px-4 py-3 hover:bg-accent/30">
                  <div className="text-sm">{c.resumen ?? "(sin resumen)"}</div>
                  <div className="text-xs text-muted-foreground">{new Date(c.fecha).toLocaleString()} · {c.direccion}</div>
                </Link>
              </li>
            ))}
          </ul></Card>
          )}
        </TabsContent>
        <TabsContent value="actions">
          {actions.length === 0 ? (
            <EmptyState icon={ListChecks} title="Sin acciones abiertas" description="Crea acciones desde el análisis de una llamada o desde el propietario." />
          ) : (
          <Card><ul className="divide-y divide-border">
            {actions.map((a) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <div>{a.titulo}</div>
                <div className="text-xs text-muted-foreground">{a.estado} · {a.vencimiento ?? "—"}</div>
              </li>
            ))}
          </ul></Card>
          )}
        </TabsContent>
        <TabsContent value="building">
          <Card><CardContent className="p-4 text-sm">
            {building ? (
              <div className="space-y-1">
                <div className="font-medium">{building.direccion}</div>
                <div className="text-xs text-muted-foreground">{building.ciudad} · {building.codigo_postal ?? "—"}</div>
                <div className="text-xs">Propietarios: {building.numero_propietarios ?? "?"} · DH: {building.division_horizontal ? "Sí" : "No"}</div>
              </div>
            ) : <div className="text-muted-foreground">Sin edificio asociado</div>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

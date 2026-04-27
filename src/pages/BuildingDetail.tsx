import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Users, Boxes, PhoneCall, X } from "lucide-react";
import { AddOwnerToBuildingDialog, NewAssetDialog, SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";
import { toast } from "sonner";

export default function BuildingDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [building, setBuilding] = useState<any>(null);
  const [bos, setBos] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: b } = await supabase.from("buildings").select("*").eq("id", id).maybeSingle();
    setBuilding(b);
    const { data: bo } = await supabase
      .from("building_owners")
      .select("building_id, owner_id, cuota, subrole, rol_notas, owners:owner_id(id, nombre, rol, email, telefono)")
      .eq("building_id", id);
    setBos(bo ?? []);
    const { data: ass } = await supabase.from("assets").select("*").eq("building_id", id);
    setAssets(ass ?? []);
    const ownerIds = (bo ?? []).map((r: any) => r.owner_id);
    if (ownerIds.length) {
      const { data: cs } = await supabase.from("calls").select("id, owner_id, fecha, resumen, direccion").in("owner_id", ownerIds).order("fecha", { ascending: false }).limit(50);
      setCalls(cs ?? []);
    } else setCalls([]);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const removeOwner = async (ownerId: string) => {
    const { error } = await supabase.from("building_owners").delete().eq("building_id", id).eq("owner_id", ownerId);
    if (error) return toast.error(error.message);
    toast.success("Propietario quitado");
    load();
  };

  if (!building) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  const existingOwnerIds = bos.map((r) => r.owner_id);
  const totalCuota = bos.reduce((a, r) => a + (Number(r.cuota) || 0), 0);

  return (
    <div className="space-y-6">
      <Crumbs items={[{ label: "Edificios", to: "/edificios" }, { label: building.direccion }]} />
      <PageHeader
        eyebrow={`Edificio · ${building.ciudad ?? ""}`}
        title={building.direccion}
        subtitle={`${building.ciudad}${building.codigo_postal ? ` · ${building.codigo_postal}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {building.division_horizontal && <Badge variant="gold">DH</Badge>}
            <Badge variant="outline">{building.estado}</Badge>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card><div className="p-5"><Eyebrow>Propietarios</Eyebrow><div className="mt-2"><MetricValue size="lg">{bos.length}</MetricValue></div></div></Card>
            <Card><div className="p-5"><Eyebrow>Activos</Eyebrow><div className="mt-2"><MetricValue size="lg">{assets.length}</MetricValue></div></div></Card>
            <Card><div className="p-5"><Eyebrow>Cuota total</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="%">{totalCuota}</MetricValue></div></div></Card>
          </div>

          <Tabs defaultValue="owners">
            <TabsList>
              <TabsTrigger value="owners">Propietarios ({bos.length})</TabsTrigger>
              <TabsTrigger value="assets">Activos ({assets.length})</TabsTrigger>
              <TabsTrigger value="calls">Llamadas ({calls.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="owners" className="space-y-3">
              <div className="flex justify-end">
                <AddOwnerToBuildingDialog buildingId={id} existingOwnerIds={existingOwnerIds} onAdded={load} />
              </div>
              {bos.length === 0 ? (
                <EmptyState icon={Users} title="Sin propietarios asociados" description="Añade los propietarios que componen este edificio (herederos, usufructuarios, etc.) con su sub-rol y cuota." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {bos.map((r) => (
                      <li key={r.owner_id} className="flex items-center justify-between px-4 py-3 hover:bg-surface-1/30 transition-colors">
                        <div>
                          <Link to={`/propietarios/${r.owner_id}`} className="text-sm font-medium text-foreground hover:text-gold">{r.owners?.nombre}</Link>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {r.owners?.email ?? r.owners?.telefono ?? "—"}
                            {r.rol_notas ? ` · ${r.rol_notas}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {r.cuota != null && <Badge variant="gold">{r.cuota}%</Badge>}
                          <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                          {r.owners?.rol && <Badge variant="info">{r.owners.rol}</Badge>}
                          <Button size="icon" variant="ghost" onClick={() => removeOwner(r.owner_id)}><X className="h-3 w-3" /></Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="assets" className="space-y-3">
              <div className="flex justify-end">
                <NewAssetDialog defaultBuildingId={id} onCreated={load} />
              </div>
              {assets.length === 0 ? (
                <EmptyState icon={Boxes} title="Sin activos en este edificio" description="Crea activos asociados a este edificio (viviendas, locales, etc.)." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {assets.map((a) => (
                      <li key={a.id}>
                        <Link to={`/activos/${a.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div className="text-sm font-medium text-foreground">{a.tipo} · {a.ubicacion}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {a.estado} · {a.superficie_m2 ?? "?"} m²
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="calls">
              {calls.length === 0 ? (
                <EmptyState icon={PhoneCall} title="Sin llamadas registradas" description="Las llamadas con cualquiera de los propietarios del edificio aparecerán aquí." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <Link to={`/llamadas/${c.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div className="text-sm text-foreground">{c.resumen ?? "(sin resumen)"}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {new Date(c.fecha).toLocaleString()} · {c.direccion}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
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

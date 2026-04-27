import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
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

  return (
    <div>
      <Crumbs items={[{ label: "Edificios", to: "/edificios" }, { label: building.direccion }]} />
      <PageHeader
        title={building.direccion}
        subtitle={`${building.ciudad}${building.codigo_postal ? ` · ${building.codigo_postal}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {building.division_horizontal && <Badge variant="secondary">DH</Badge>}
            <Badge variant="outline">{building.estado}</Badge>
          </div>
        }
      />

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
            <Card><ul className="divide-y divide-border">
              {bos.map((r) => (
                <li key={r.owner_id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <Link to={`/propietarios/${r.owner_id}`} className="text-sm font-medium hover:text-primary">{r.owners?.nombre}</Link>
                    <div className="text-xs text-muted-foreground">
                      {r.owners?.email ?? r.owners?.telefono ?? "—"}
                      {r.rol_notas ? ` · ${r.rol_notas}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.cuota != null && <Badge variant="secondary">{r.cuota}%</Badge>}
                    <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                    {r.owners?.rol && <Badge>{r.owners.rol}</Badge>}
                    <Button size="icon" variant="ghost" onClick={() => removeOwner(r.owner_id)}><X className="h-3 w-3" /></Button>
                  </div>
                </li>
              ))}
            </ul></Card>
          )}
        </TabsContent>

        <TabsContent value="assets" className="space-y-3">
          <div className="flex justify-end">
            <NewAssetDialog defaultBuildingId={id} onCreated={load} />
          </div>
          {assets.length === 0 ? (
            <EmptyState icon={Boxes} title="Sin activos en este edificio" description="Crea activos asociados a este edificio (viviendas, locales, etc.)." />
          ) : (
            <Card><ul className="divide-y divide-border">
              {assets.map((a) => (
                <li key={a.id}>
                  <Link to={`/activos/${a.id}`} className="block px-4 py-3 hover:bg-accent/30">
                    <div className="text-sm font-medium">{a.tipo} · {a.ubicacion}</div>
                    <div className="text-xs text-muted-foreground">{a.estado} · {a.superficie_m2 ?? "?"} m²</div>
                  </Link>
                </li>
              ))}
            </ul></Card>
          )}
        </TabsContent>

        <TabsContent value="calls">
          {calls.length === 0 ? (
            <EmptyState icon={PhoneCall} title="Sin llamadas registradas" description="Las llamadas con cualquiera de los propietarios del edificio aparecerán aquí." />
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
      </Tabs>
    </div>
  );
}
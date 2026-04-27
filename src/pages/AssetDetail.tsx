import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";

export default function AssetDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [asset, setAsset] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [building, setBuilding] = useState<any>(null);
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
      }
    })();
  }, [id]);

  if (!asset) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  return (
    <div>
      <Link to="/activos" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> {t.common.back}
      </Link>
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
          <Card><CardContent className="p-4 text-sm">
            {owner ? (
              <Link to={`/propietarios/${owner.id}`} className="flex items-center justify-between rounded border border-border p-3 hover:bg-accent/30">
                <div>
                  <div className="font-medium">{owner.nombre}</div>
                  <div className="text-xs text-muted-foreground">{owner.email ?? owner.telefono ?? "—"}</div>
                </div>
                <Badge variant="outline">{owner.rol}</Badge>
              </Link>
            ) : <div className="text-muted-foreground">Sin propietario asignado</div>}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="calls">
          <Card><ul className="divide-y divide-border">
            {calls.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
            {calls.map((c) => (
              <li key={c.id}>
                <Link to={`/llamadas/${c.id}`} className="block px-4 py-3 hover:bg-accent/30">
                  <div className="text-sm">{c.resumen ?? "(sin resumen)"}</div>
                  <div className="text-xs text-muted-foreground">{new Date(c.fecha).toLocaleString()} · {c.direccion}</div>
                </Link>
              </li>
            ))}
          </ul></Card>
        </TabsContent>
        <TabsContent value="actions">
          <Card><ul className="divide-y divide-border">
            {actions.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
            {actions.map((a) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <div>{a.titulo}</div>
                <div className="text-xs text-muted-foreground">{a.estado} · {a.vencimiento ?? "—"}</div>
              </li>
            ))}
          </ul></Card>
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

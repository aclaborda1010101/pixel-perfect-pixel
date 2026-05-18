import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Phone, MapPin, ArrowUpDown } from "lucide-react";

type SortKey = "pct" | "last" | "estado";

function estadoBadge(o: any): { label: string; variant: "default" | "outline" | "destructive" | "info" | "gold" | "warning" | "success" } {
  if ((o.contactos_previos ?? 0) === 0) return { label: "Sin contactar", variant: "destructive" };
  if ((o.metadatos?.interes ?? "").toString().toLowerCase().includes("alto")) return { label: "Interesado", variant: "success" };
  if ((o.metadatos?.interes ?? "").toString().toLowerCase().includes("no")) return { label: "No interesa", variant: "outline" };
  return { label: "Contactado", variant: "info" };
}

export default function ComercialEdificioDetalle() {
  const { id } = useParams<{ id: string }>();
  const [sort, setSort] = useState<SortKey>("pct");

  const { data } = useQuery({
    queryKey: ["comercial:edificio", id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: b }, { data: score }, { data: owners }] = await Promise.all([
        supabase.from("buildings").select("*").eq("id", id!).maybeSingle(),
        (supabase.from("v_building_score" as any) as any).select("*").eq("id", id!).maybeSingle(),
        (supabase.from("v_owner_score" as any) as any).select("*").eq("building_id", id!),
      ]);
      return { b: b as any, score: (score as any), owners: (owners ?? []) as any[] };
    },
  });

  if (!data?.b) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando edificio…</div>;
  }

  const b = data.b;
  const s = data.score ?? {};
  const owners = [...(data.owners ?? [])].sort((a, b) => {
    if (sort === "pct") return Number(b.pct_propiedad ?? 0) - Number(a.pct_propiedad ?? 0);
    if (sort === "last") {
      const la = a.last_call_at ? new Date(a.last_call_at).getTime() : 0;
      const lb = b.last_call_at ? new Date(b.last_call_at).getTime() : 0;
      return lb - la;
    }
    return Number((a.contactos_previos ?? 0) === 0 ? 0 : 1) - Number((b.contactos_previos ?? 0) === 0 ? 0 : 1);
  });

  const mapsQuery = encodeURIComponent(`${b.direccion}, ${b.ciudad ?? "Madrid"}`);
  const scoreComponents = [
    { label: "Nº viviendas", value: Number(s.s_viviendas ?? 0) * 100, weight: 30 },
    { label: "m² totales", value: Number(s.s_m2 ?? 0) * 100, weight: 20 },
    { label: "Ratio m²/viv", value: Number(s.s_ratio ?? 0) * 100, weight: 20 },
    { label: "Nº propietarios", value: Number(s.s_owners ?? 0) * 100, weight: 20 },
    { label: "No división horizontal", value: Number(s.s_no_dh ?? 0) * 100, weight: 10 },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<><Link to="/comercial" className="hover:text-gold">Cartera</Link> · Edificio</>}
        title={b.direccion}
        subtitle={`${b.ciudad ?? ""} ${b.codigo_postal ?? ""}`}
        actions={
          <Badge variant={b.division_horizontal ? "outline" : "gold"}>
            {b.division_horizontal ? "División horizontal" : "Sin DH"}
          </Badge>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Catastro */}
        <Card>
          <CardHeader>
            <Eyebrow>Datos catastrales</Eyebrow>
            <CardTitle>Información del inmueble</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div><Eyebrow>m² totales</Eyebrow><div className="mt-1"><MetricValue size="md">{s.m2_total ? Number(s.m2_total).toLocaleString() : "—"}</MetricValue></div></div>
            <div><Eyebrow>Viviendas</Eyebrow><div className="mt-1"><MetricValue size="md">{s.num_viviendas ?? "—"}</MetricValue></div></div>
            <div><Eyebrow>Ratio m²/viv</Eyebrow><div className="mt-1"><MetricValue size="md">{s.m2_total && s.num_viviendas ? (Number(s.m2_total) / Number(s.num_viviendas)).toFixed(1) : "—"}</MetricValue></div></div>
            <div><Eyebrow>Propietarios</Eyebrow><div className="mt-1"><MetricValue size="md">{s.owners_count ?? 0}</MetricValue></div></div>
            <div className="col-span-2"><Eyebrow>Ref. catastral</Eyebrow><div className="font-mono text-xs text-foreground">{b.catastro_ref ?? "—"}</div></div>
          </CardContent>
        </Card>

        {/* Scoring */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <Eyebrow>Scoring</Eyebrow>
              <CardTitle>Atractivo comercial</CardTitle>
            </div>
            <MetricValue size="xl" className="text-gold">{Number(s.score ?? 0).toFixed(0)}</MetricValue>
          </CardHeader>
          <CardContent className="space-y-3">
            {scoreComponents.map((c) => (
              <div key={c.label} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-foreground">{c.label}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">{c.value.toFixed(0)} · peso {c.weight}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                  <div className="h-full bg-gold/80" style={{ width: `${c.value}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Mapa */}
        <Card className="overflow-hidden">
          <CardHeader>
            <Eyebrow><MapPin className="mr-1 inline h-3 w-3" /> Ubicación</Eyebrow>
            <CardTitle>{b.ciudad ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              title="Mapa edificio"
              src={`https://www.google.com/maps?q=${mapsQuery}&output=embed`}
              className="h-[260px] w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </CardContent>
        </Card>
      </div>

      {/* Propietarios */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <Eyebrow>Propietarios · {owners.length}</Eyebrow>
            <CardTitle>Estado de contacto</CardTitle>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["pct", "last", "estado"] as SortKey[]).map((k) => (
              <Button key={k} size="sm" variant={sort === k ? "gold" : "outline"} onClick={() => setSort(k)}>
                <ArrowUpDown className="h-3 w-3" />
                {k === "pct" ? "% propiedad" : k === "last" ? "Última interacción" : "Estado"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-faint">
            {owners.map((o) => {
              const e = estadoBadge(o);
              const sinContacto = (o.contactos_previos ?? 0) === 0;
              return (
                <li key={o.owner_id} className={`px-5 py-3 ${sinContacto ? "bg-destructive/5" : ""}`}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{o.nombre ?? "—"}</div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {o.telefono ?? "sin teléfono"} · sub-score {Number(o.score ?? 0).toFixed(0)}
                      </div>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-gold">{Number(o.pct_propiedad ?? 0).toFixed(1)}%</span>
                    <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                      {o.last_call_at ? new Date(o.last_call_at).toLocaleDateString() : "Nunca"}
                    </span>
                    <Badge variant={e.variant as any}>{e.label}</Badge>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/comercial/preparar/${o.owner_id}`}>
                        <Phone className="h-3 w-3" /> Preparar
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
            {owners.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted-foreground">Sin propietarios registrados.</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
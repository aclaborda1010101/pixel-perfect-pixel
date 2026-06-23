import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Home, Store, Briefcase, Package, Car, Hotel, Building as BuildingIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

function iconForUso(uso: string | null | undefined) {
  const u = (uso ?? "").toLowerCase();
  if (u.includes("vivienda") || u.includes("residencial")) return Home;
  if (u.includes("comerc")) return Store;
  if (u.includes("ofic")) return Briefcase;
  if (u.includes("almac")) return Package;
  if (u.includes("aparc") || u.includes("garaj")) return Car;
  if (u.includes("hostel")) return Hotel;
  return BuildingIcon;
}

export function CatastroDetalladoCard({ buildingId, refCatastral }: { buildingId: string; refCatastral?: string | null }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["catastro_detallado", buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const { data } = await (supabase.from("catastro_data" as any) as any)
        .select("*").eq("building_id", buildingId).maybeSingle();
      return data as any;
    },
  });

  const d = data?.dnprc_json ?? {};
  const subparcelas: any[] = Array.isArray(d.subparcelas) ? d.subparcelas : [];
  const hasParsed = !!(d.direccion_oficial || d.uso_principal || subparcelas.length);

  // Resumen agregado por uso: m² y nº unidades.
  const resumenUso = (() => {
    const m = new Map<string, { m2: number; uds: number }>();
    for (const sp of subparcelas) {
      const uso = (sp?.uso ?? "Sin clasificar").toString();
      const m2 = Number(sp?.superficie_m2) || 0;
      const cur = m.get(uso) ?? { m2: 0, uds: 0 };
      cur.m2 += m2;
      cur.uds += 1;
      m.set(uso, cur);
    }
    return Array.from(m.entries())
      .map(([uso, v]) => ({ uso, ...v }))
      .sort((a, b) => b.m2 - a.m2);
  })();
  const totalM2 = resumenUso.reduce((s, r) => s + r.m2, 0);

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Datos catastrales · OVC Consulta_DNPRC</Eyebrow>
        <CardTitle>Información detallada del inmueble</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <div className="text-sm text-muted-foreground">Cargando datos catastrales…</div>}

        {!isLoading && !data && (
          <div className="rounded-md border border-border-faint p-3 text-sm text-muted-foreground">
            No hay datos catastrales descargados. Pulsa "Descargar Catastro + Planos + IA" en la sección Análisis IA.
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Ref. catastral" value={data.refcatastral || refCatastral} mono />
              <Field label="Dirección oficial" value={d.direccion_oficial} className="md:col-span-2" />
              <Field label="Uso principal" value={d.uso_principal} />
              <Field label="Año construcción" value={d.ano_construccion} />
              <Field label="Coef. participación" value={d.coef_participacion != null ? `${d.coef_participacion}%` : null} />
              <Field label="Superficie construida" value={d.superficie_construida != null ? `${Number(d.superficie_construida).toLocaleString()} m²` : null} />
              <Field label="Superficie solar" value={d.superficie_solar != null ? `${Number(d.superficie_solar).toLocaleString()} m²` : null} />
              <Field label="Nº plantas (catastro)" value={d.num_plantas_catastro} />
              <Field label="% uso terciario" value={d.pct_terciario != null ? `${d.pct_terciario}%` : null} accent={Number(d.pct_terciario) > 33} />
              <Field label="Ancho calle" value={data.ancho_calle_m != null ? `${data.ancho_calle_m} m` : null} />
              <Field label="Lat / Lon" value={data.lat && data.lon ? `${Number(data.lat).toFixed(5)}, ${Number(data.lon).toFixed(5)}` : null} mono />
            </div>

            {!hasParsed && (
              <div className="rounded-md border border-dashed border-border-faint p-3 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                DNPRC pendiente de parseo. Re-procesa el edificio para extraer los campos.
              </div>
            )}

            {subparcelas.length > 0 && (
              <div className="rounded-md border border-border-faint bg-surface-1/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                    Resumen por uso
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-foreground">
                    Total: {totalM2.toLocaleString()} m² · {subparcelas.length} uds
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {resumenUso.map((r) => {
                    const Icon = iconForUso(r.uso);
                    return (
                      <span
                        key={r.uso}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border-faint bg-background/40 px-2.5 py-1 text-xs"
                      >
                        <Icon className="h-3.5 w-3.5 text-gold" />
                        <span className="text-foreground">{r.uso}</span>
                        <span className="font-mono tabular-nums text-foreground/90">
                          {r.m2.toLocaleString()} m²
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          ({r.uds} {r.uds === 1 ? "ud" : "uds"})
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {subparcelas.length > 0 && (
              <div className="rounded-md border border-border-faint">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-1/40"
                >
                  <div className="flex items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 text-gold" /> : <ChevronRight className="h-4 w-4 text-gold" />}
                    <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Detalle subparcelas</span>
                    <Badge variant="outline">{subparcelas.length}</Badge>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                    {subparcelas.reduce((s, x) => s + (Number(x.superficie_m2) || 0), 0).toLocaleString()} m² total
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border-faint">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-1/40 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left">#</th>
                          <th className="px-3 py-2 text-left">Uso</th>
                          <th className="px-3 py-2 text-left">Planta</th>
                          <th className="px-3 py-2 text-left">Puerta</th>
                          <th className="px-3 py-2 text-right">Superficie</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-faint">
                        {subparcelas.map((sp, i) => {
                          const Icon = iconForUso(sp.uso);
                          return (
                            <tr key={i}>
                              <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{i + 1}</td>
                              <td className="px-3 py-2">
                                <span className="inline-flex items-center gap-2">
                                  <Icon className="h-3.5 w-3.5 text-gold" />
                                  <span>{sp.uso ?? "—"}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{sp.planta ?? "—"}</td>
                              <td className="px-3 py-2 font-mono text-xs">{sp.puerta ?? "—"}</td>
                              <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                                {sp.superficie_m2 != null ? `${Number(sp.superficie_m2).toLocaleString()} m²` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {data.plano_url ? (
                <Button asChild size="sm" variant="outline">
                  <a href={data.plano_url} target="_blank" rel="noreferrer">Abrir plano catastral SVG ↗</a>
                </Button>
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground border border-border/40 rounded px-2 py-1">
                  Plano SVG no disponible en Catastro
                </span>
              )}
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                fetched: {data.fetched_at ? new Date(data.fetched_at).toLocaleString("es") : "—"}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono, accent, className }: { label: string; value: any; mono?: boolean; accent?: boolean; className?: string }) {
  return (
    <div className={`rounded-md border border-border-faint bg-surface-1/40 p-3 ${className ?? ""}`}>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={`mt-1 ${mono ? "font-mono text-xs break-all" : "text-sm"} ${accent ? "text-gold" : "text-foreground"}`}>
        {value != null && value !== "" ? value : "—"}
      </div>
    </div>
  );
}
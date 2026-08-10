import { useQuery } from "@tanstack/react-query";
import { Building2, User, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { agruparPorCapa, type TitularCapa as Titular } from "./titularidadCapas";

function fmtPct(v: number | null) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} %`;
}

function fmtFecha(f: string | null) {
  if (!f) return null;
  const d = new Date(f);
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("es-ES");
  return f;
}

export function TitularidadRegistral({ buildingId }: { buildingId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["titularidad-registral", buildingId],
    enabled: !!buildingId,
    queryFn: async () => {
      const { data } = await (supabase.from("v_titularidad_registral" as any) as any)
        .select("*")
        .eq("building_id", buildingId);
      return (data ?? []) as Titular[];
    },
  });

  if (isLoading || !data || data.length === 0) return null;

  const fecha = fmtFecha(data.find((t) => t.fecha_emision_nota)?.fecha_emision_nota ?? null);
  const capas = agruparPorCapa(data);
  const sinContacto = data.filter((t) => t.tiene_contacto_crm === false).length;

  return (
    <Card>
      <CardHeader className="gap-1">
        <Eyebrow>Titularidad registral (nota simple) · {data.length}</Eyebrow>
        <CardTitle>Lo que dice el Registro, coincida o no con el CRM</CardTitle>
        <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {fecha ? `Nota de ${fecha}` : "Sin fecha de emisión"}
          </span>
          {capas
            .filter((c) => c.suma != null)
            .map((c) => (
              <span
                key={`sum-${c.rol}`}
                className={cn(
                  "rounded-[4px] border px-1.5 py-0.5 tabular-nums",
                  c.completa
                    ? "border-border-faint text-muted-foreground"
                    : "border-warning/50 bg-warning-soft/40 text-warning",
                )}
                title={
                  c.completa
                    ? undefined
                    : `La capa de ${c.label.toLowerCase()} no suma 100 %`
                }
              >
                {c.label} {Number(c.suma).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %
              </span>
            ))}
          {sinContacto > 0 && <span>{sinContacto} sin contacto en el CRM</span>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          {capas.map((capa) => (
          <table key={capa.rol} className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-faint bg-muted/20 text-left font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                <th className="px-5 py-2 font-normal" colSpan={2}>
                  Capa · {capa.label}
                </th>
                <th className="px-3 py-2 text-right font-normal tabular-nums">
                  {capa.suma != null ? (
                    <span className={cn(!capa.completa && "text-warning")}>
                      {Number(capa.suma).toLocaleString("es-ES", { maximumFractionDigits: 2 })} %
                    </span>
                  ) : (
                    "sin %"
                  )}
                </th>
                <th className="px-5 py-2 font-normal">
                  {capa.suma == null ? "" : capa.completa ? "capa completa" : "capa incompleta"}
                </th>
              </tr>
              <tr className="border-b border-border-faint text-left font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                <th className="px-5 py-2 font-normal">Titular</th>
                <th className="px-3 py-2 font-normal">DNI / CIF</th>
                <th className="px-3 py-2 text-right font-normal">%</th>
                <th className="px-5 py-2 font-normal">Rol</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-faint">
              {capa.titulares.map((t) => (
                <tr key={t.titular_id}>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {t.es_sociedad ? (
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-gold" />
                      ) : (
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-medium text-foreground">{t.nombre_extraido || "—"}</span>
                      {t.es_sociedad && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[9px]">Sociedad</Badge>
                      )}
                      {t.tiene_contacto_crm === false && (
                        <Badge
                          variant="outline"
                          className="h-4 border-warning/50 bg-warning-soft/40 px-1.5 text-[9px] text-warning"
                          title="No hay un propietario equivalente en el CRM: hay que localizarlo"
                        >
                          Sin contacto en el CRM
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
                    {t.cif_dni || "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-foreground">
                    {fmtPct(t.porcentaje) ?? <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {capa.label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

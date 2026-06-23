import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { ShieldCheck, ShieldAlert, ShieldX, Clock, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type IeeEstado =
  | "favorable" | "desfavorable_leve" | "desfavorable_grave"
  | "pendiente" | "caducada" | "no_procede" | "desconocido";

type IeeFields = {
  iee_estado?: IeeEstado | null;
  iee_fecha_inspeccion?: string | null;
  iee_proxima_revision?: string | null;
  iee_actualizado_at?: string | null;
};

function fmt(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("es", { month: "short", year: "numeric" }); }
  catch { return d; }
}
function yearsBetween(a: string | null | undefined, b: Date = new Date()) {
  if (!a) return null;
  const t = new Date(a).getTime();
  if (!isFinite(t)) return null;
  return (b.getTime() - t) / (365.25 * 86400_000);
}

function meta(e?: IeeEstado | null) {
  switch (e) {
    case "favorable":          return { label: "IEE favorable", variant: "gold" as const, Icon: ShieldCheck, tone: "text-emerald-500" };
    case "desfavorable_leve":  return { label: "IEE desfavorable (leve)", variant: "outline" as const, Icon: ShieldAlert, tone: "text-amber-500" };
    case "desfavorable_grave": return { label: "IEE desfavorable (grave)", variant: "destructive" as const, Icon: ShieldX, tone: "text-red-500" };
    case "caducada":           return { label: "IEE caducada", variant: "destructive" as const, Icon: Clock, tone: "text-red-500" };
    case "pendiente":          return { label: "IEE pendiente", variant: "destructive" as const, Icon: ShieldAlert, tone: "text-red-500" };
    case "no_procede":         return { label: "IEE no procede", variant: "outline" as const, Icon: ShieldCheck, tone: "text-muted-foreground" };
    default:                   return { label: "IEE sin datos", variant: "outline" as const, Icon: ShieldAlert, tone: "text-muted-foreground" };
  }
}

function humanText(b: IeeFields): string {
  const e = b.iee_estado ?? "desconocido";
  if (e === "favorable") return `Próxima revisión: ${fmt(b.iee_proxima_revision)}`;
  if (e === "caducada")   return `Caducada desde ${fmt(b.iee_proxima_revision)}`;
  if (e === "desfavorable_leve" || e === "desfavorable_grave") {
    const y = yearsBetween(b.iee_fecha_inspeccion);
    return `Desde ${fmt(b.iee_fecha_inspeccion)}${y != null ? ` (${y.toFixed(1)} a sin corregir)` : ""}`;
  }
  if (e === "pendiente")  return "Obligado y nunca presentado";
  if (e === "no_procede") return "Edificio no obligado";
  return "Sin consultar todavía";
}

export function IeeBadge({ building }: { building: IeeFields }) {
  const m = meta(building?.iee_estado);
  return (
    <Badge variant={m.variant} className="gap-1">
      <m.Icon className={`h-3 w-3 ${m.tone}`} />
      <span>{m.label}</span>
    </Badge>
  );
}

export function IeeCard({ buildingId, building }: { buildingId: string; building: IeeFields }) {
  const [busy, setBusy] = useState(false);
  const m = meta(building?.iee_estado);

  const refresh = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch_iee_madrid", { body: { building_id: buildingId } });
      if (error) throw error;
      if ((data as any)?.ok) toast.success(`IEE actualizado: ${(data as any).estado}`);
      else toast.error((data as any)?.error || "Error consultando IEE");
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast.error(e.message || "Error");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <Eyebrow><m.Icon className={`mr-1 inline h-3 w-3 ${m.tone}`} /> IEE / ITE</Eyebrow>
          <CardTitle>{m.label}</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          <span className="ml-1">Actualizar</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-sm text-foreground">{humanText(building)}</div>
        {building?.iee_fecha_inspeccion && (
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            Última inspección: {fmt(building.iee_fecha_inspeccion)}
          </div>
        )}
        {building?.iee_actualizado_at && (
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            Consultado: {new Date(building.iee_actualizado_at).toLocaleDateString("es")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Mic, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";

export type OwnerCallStats = {
  owner_id: string;
  intentos_totales: number;
  veces_conectado: number;
  salientes: number;
  entrantes: number;
  ultima_llamada: string | null;
  ultima_vez_conectado: string | null;
  dias_desde_ultima_llamada: number | null;
  llamadas_sin_edificio?: number | null;
};

export type OwnerCallRow = {
  owner_id: string;
  hs_timestamp: string;
  direccion: "OUTBOUND" | "INBOUND" | string;
  resultado: string | null;
  duracion_seg: number | null;
  nota: string | null;
  tiene_grabacion: boolean;
  hs_id?: string | null;
  building_id?: string | null;
  sin_edificio?: boolean | null;
};

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function resultTone(r: string | null): "success" | "muted" | "danger" {
  const v = (r ?? "").toLowerCase();
  if (v.startsWith("conectado")) return "success";
  if (v.includes("equivocado")) return "danger";
  return "muted";
}

function ResultBadge({ resultado }: { resultado: string | null }) {
  if (!resultado) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = resultTone(resultado);
  const cls =
    tone === "success" ? "bg-success-soft text-success border-transparent"
    : tone === "danger" ? "bg-destructive/10 text-destructive border-transparent"
    : "bg-muted text-muted-foreground border-transparent";
  return <Badge className={cn("rounded-[4px] text-[11px] font-medium", cls)}>{resultado}</Badge>;
}

function fmtDur(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

function NoteCell({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  const t = (text ?? "").trim();
  if (!t) return <span className="text-xs text-muted-foreground">—</span>;
  const short = t.length > 90;
  if (!short) return <span className="text-sm">{t}</span>;
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="text-left text-sm hover:text-foreground"
    >
      {open ? t : t.slice(0, 90) + "…"}
    </button>
  );
}

export function ContactHistoryCard({ ownerId }: { ownerId: string }) {
  const [stats, setStats] = useState<OwnerCallStats | null>(null);
  const [rows, setRows] = useState<OwnerCallRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [s, c] = await Promise.all([
        (supabase.from("v_owner_call_stats" as any) as any).select("*").eq("owner_id", ownerId).maybeSingle(),
        (supabase.from("v_owner_calls_enriched" as any) as any)
          .select("*")
          .eq("owner_id", ownerId)
          .order("hs_timestamp", { ascending: false })
          .limit(200),
      ]);
      if (cancelled) return;
      setStats((s.data as OwnerCallStats | null) ?? null);
      setRows(((c.data as OwnerCallRow[] | null) ?? []));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  const hasStats = stats && Number(stats.intentos_totales ?? 0) > 0;

  const sinEdificio = Number(stats?.llamadas_sin_edificio ?? 0);

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Historial de contacto</Eyebrow>
        <CardTitle className="flex items-center gap-2 text-base">
          <PhoneCall className="h-4 w-4 text-primary" />
          Llamadas
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="text-sm text-muted-foreground">Cargando…</div>
        ) : !hasStats ? (
          <div className="text-sm text-muted-foreground">Sin llamadas registradas</div>
        ) : (
          <>
            {sinEdificio > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <div className="font-medium text-amber-900 dark:text-amber-200">
                    {sinEdificio} {sinEdificio === 1 ? "llamada sin asignar a edificio" : "llamadas sin asignar a edificio"}
                  </div>
                  <div className="text-xs text-amber-900/80 dark:text-amber-200/80">
                    El propietario aparece en varios edificios y estas llamadas no traen deal en HubSpot. Asígnalas manualmente desde la fila.
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <div>
                <Eyebrow>Intentos · cogidas</Eyebrow>
                <div className="mt-1">
                  <MetricValue size="lg">
                    {stats!.intentos_totales} <span className="text-muted-foreground">·</span> {stats!.veces_conectado}
                  </MetricValue>
                </div>
              </div>
              <div className="text-sm">
                <div className="text-muted-foreground text-xs uppercase tracking-eyebrow">Última llamada</div>
                <div className="mt-1 font-medium">
                  {fmtDate(stats!.ultima_llamada)}
                  {stats!.dias_desde_ultima_llamada != null && (
                    <span className="text-muted-foreground"> · hace {stats!.dias_desde_ultima_llamada} d</span>
                  )}
                </div>
              </div>
              <div className="text-sm">
                <div className="text-muted-foreground text-xs uppercase tracking-eyebrow">Última vez que habló</div>
                <div className="mt-1 font-medium">
                  {stats!.ultima_vez_conectado ? fmtDate(stats!.ultima_vez_conectado) : <span className="text-muted-foreground">nunca ha cogido</span>}
                </div>
              </div>
              <div className="text-sm">
                <div className="text-muted-foreground text-xs uppercase tracking-eyebrow">Dirección</div>
                <div className="mt-1 font-medium">
                  Salientes {stats!.salientes} <span className="text-muted-foreground">·</span> Entrantes {stats!.entrantes}
                </div>
              </div>
            </div>

            {rows.length > 0 && (
              <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-eyebrow text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3 text-left font-medium">Fecha</th>
                      <th className="py-2 pr-3 text-left font-medium">Dir</th>
                      <th className="py-2 pr-3 text-left font-medium">Resultado</th>
                      <th className="py-2 pr-3 text-left font-medium">Duración</th>
                      <th className="py-2 pr-3 text-left font-medium">Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.hs_timestamp}-${i}`} className="border-b last:border-0 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.hs_timestamp)}</td>
                        <td className="py-2 pr-3">
                          {r.direccion === "INBOUND" ? (
                            <ArrowDownLeft className="h-4 w-4 text-info" aria-label="Entrante" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" aria-label="Saliente" />
                          )}
                        </td>
                        <td className="py-2 pr-3"><ResultBadge resultado={r.resultado} /></td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {fmtDur(r.duracion_seg)}
                            {r.tiene_grabacion && <Mic className="h-3 w-3 text-primary" aria-label="Con grabación" />}
                          </span>
                        </td>
                        <td className="py-2 pr-3 max-w-[540px]"><NoteCell text={r.nota} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, CircleDashed, XCircle, Target, Star, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Estado = "tenemos" | "a_medias" | "falta";
type Kpi = { clave: string; label: string; estado: Estado; evidencia: string | null; fuente?: string | null; fecha?: string | null };
type Resp = { total: number; completados: number; kpis: Kpi[]; a_abordar: string[] };

const FUENTE_LABEL: Record<string, string> = {
  llamada: "Llamada",
  resumen_ia_llamada: "Resumen IA de llamada",
  transcripcion: "Transcripción",
  nota_hs: "Nota HubSpot",
  whatsapp: "WhatsApp",
};
function fuenteLabel(f?: string | null): string {
  if (!f) return "notas";
  return FUENTE_LABEL[f] ?? f;
}

export function KpiChecklistCard({ ownerId }: { ownerId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todos" | "pendientes">("todos");
  const [source, setSource] = useState<"cache" | "fresh" | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<string | null>(null);
  // Map clave-KPI → primera vez que se consiguió (Tanda B · punto 2).
  const [prior, setPrior] = useState<Record<string, { fecha: string | null; veces: number }>>({});

  useEffect(() => {
    (async () => {
      const { data: st } = await (supabase.from("owner_kpis_state" as any) as any)
        .select("k, first_done_at, times_done").eq("owner_id", ownerId);
      const m: Record<string, { fecha: string | null; veces: number }> = {};
      for (const r of (st as any[] ?? [])) {
        m[String(r.k)] = { fecha: r.first_done_at ?? null, veces: Number(r.times_done ?? 0) };
      }
      setPrior(m);
    })();
  }, [ownerId]);

  async function run(force = false) {
    setLoading(true); setError(null);
    try {
      // 1) Actividad más reciente del propietario (incluye llamadas solo-deal
      // atribuidas por teléfono, además de la RPC clásica basada en contacto).
      const [{ data: laRaw }, { data: lastCall }] = await Promise.all([
        (supabase.rpc as any)("owner_last_activity_at", { _owner_id: ownerId }),
        (supabase.from("v_owner_calls_enriched" as any) as any)
          .select("hs_timestamp")
          .eq("owner_id", ownerId)
          .order("hs_timestamp", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const laA = (laRaw as any) ?? null;
      const laB = (lastCall as any)?.hs_timestamp ?? null;
      const la: string | null =
        laA && laB ? (new Date(laA) >= new Date(laB) ? laA : laB) : (laA ?? laB ?? null);
      setLastActivityAt(la);

      // 2) Caché
      if (!force) {
        const { data: cache } = await (supabase.from("owner_call_prep_cache" as any) as any)
          .select("kpis_json, kpis_generated_at, kpis_last_activity_at")
          .eq("owner_id", ownerId)
          .maybeSingle();
        const gen = (cache as any)?.kpis_generated_at;
        const cachedLA = (cache as any)?.kpis_last_activity_at;
        const stillValid = gen && (!la || new Date(la).getTime() <= new Date(gen).getTime());
        if (cache && (cache as any).kpis_json && stillValid) {
          setData((cache as any).kpis_json as Resp);
          setGeneratedAt(gen);
          setSource("cache");
          setLoading(false);
          return;
        }
      }

      // 3) Regenerar
      const { data: res, error: err } = await supabase.functions.invoke("agent_kpi_checklist", {
        body: { owner_id: ownerId },
      });
      if (err) throw err;
      setData(res as Resp);
      const nowIso = new Date().toISOString();
      setGeneratedAt(nowIso);
      setSource("fresh");
      // 4) Persistir caché
      await (supabase.from("owner_call_prep_cache" as any) as any).upsert({
        owner_id: ownerId,
        kpis_json: res,
        kpis_generated_at: nowIso,
        kpis_last_activity_at: la,
        kpis_model: "agent_kpi_checklist",
      }, { onConflict: "owner_id" });
    } catch (e: any) {
      setError(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await run(false); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const aAbordarSet = new Set(data?.a_abordar ?? []);

  // Prioridad: naranja (a abordar / a medias) > verde (tenemos) > rojo (falta)
  const naranja = (data?.kpis ?? []).filter(
    (k) => aAbordarSet.has(k.clave) || k.estado === "a_medias"
  );
  const verde = (data?.kpis ?? []).filter(
    (k) => !aAbordarSet.has(k.clave) && k.estado === "tenemos"
  );
  const rojo = (data?.kpis ?? []).filter(
    (k) => !aAbordarSet.has(k.clave) && k.estado === "falta"
  );

  const visibleNaranja = naranja;
  const visibleVerde = filter === "todos" ? verde : [];
  const visibleRojo = rojo;

  const isCuadroRentas = (k: Kpi) => k.clave === "cuadro_rentas";

  const iconFor = (k: Kpi, color: "success" | "warning" | "destructive") => {
    const cls = cn(
      "mt-0.5 h-4 w-4 flex-shrink-0",
      color === "success" && "text-success",
      color === "warning" && "text-warning",
      color === "destructive" && "text-destructive"
    );
    if (color === "success") return <CheckCircle2 className={cls} />;
    if (color === "warning") return <CircleDashed className={cls} />;
    return <XCircle className={cls} />;
  };

  const renderKpi = (k: Kpi, color: "success" | "warning" | "destructive") => (
    <li key={k.clave} className="flex items-start gap-2">
      {isCuadroRentas(k) ? (
        <Star className="mt-0.5 h-4 w-4 flex-shrink-0 fill-gold text-gold" />
      ) : (
        iconFor(k, color)
      )}
      <div className="min-w-0">
        <div className={cn("text-foreground", isCuadroRentas(k) && "font-medium")}>
          {k.label}
          {isCuadroRentas(k) && (
            <Badge variant="gold" className="ml-2 text-[10px]">prioridad</Badge>
          )}
          {prior[k.clave] && (
            <Badge variant="outline" className="ml-2 border-success/40 bg-success/10 text-[10px] text-success">
              ya conseguido{prior[k.clave].fecha ? ` · ${new Date(prior[k.clave].fecha as string).toLocaleDateString("es-ES")}` : ""}
            </Badge>
          )}
        </div>
        {k.estado === "tenemos" && k.evidencia && (
          <div className="mt-0.5 space-y-0.5">
            <div className="text-xs italic text-muted-foreground">
              «{k.evidencia}»
            </div>
            {(k.fuente || k.fecha) && (
              <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground/80">
                fuente: {fuenteLabel(k.fuente)}{k.fecha ? ` · ${k.fecha}` : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );


  return (
    <Card>
      <CardHeader>
        <Eyebrow>KPIs · qué tenemos / qué falta</Eyebrow>
        <CardTitle className="flex items-center justify-between text-base">
          <span>Cobertura de información</span>
          <div className="flex items-center gap-3">
            {data && (
              <span className="font-mono text-sm text-gold">
                {data.completados} de {data.total} completados
              </span>
            )}
            {data && (
              <div className="flex items-center gap-1 rounded-[4px] border border-border-faint p-0.5">
                <Button
                  size="sm"
                  variant={filter === "todos" ? "gold" : "ghost"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setFilter("todos")}
                >
                  Todos
                </Button>
                <Button
                  size="sm"
                  variant={filter === "pendientes" ? "gold" : "ghost"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setFilter("pendientes")}
                >
                  Pendientes
                </Button>
              </div>
            )}
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => run(true)} disabled={loading} title="Regenerar KPIs">
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </Button>
          </div>
        </CardTitle>
        {generatedAt && !loading && (
          <div className="mt-1 text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground">
            {source === "cache"
              ? `Preparación generada el ${new Date(generatedAt).toLocaleString("es-ES")} · sin cambios desde entonces`
              : `Actualizada${lastActivityAt ? ` por actividad del ${new Date(lastActivityAt).toLocaleDateString("es-ES")}` : ""} · ${new Date(generatedAt).toLocaleString("es-ES")}`}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {loading && <div className="text-muted-foreground">Analizando notas de llamadas y HubSpot…</div>}
        {error && <div className="text-destructive">Error: {error}</div>}
        {!loading && data && (
          <>
            {visibleNaranja.length > 0 && (
              <div className="rounded-[6px] border border-warning/40 bg-warning/10 p-3">
                <div className="flex items-center gap-2 text-xs uppercase tracking-eyebrow text-warning">
                  <Target className="h-3.5 w-3.5" /> A abordar en esta llamada
                </div>
                <ul className="mt-2 space-y-1.5">
                  {visibleNaranja.map((k) => renderKpi(k, "warning"))}
                </ul>
              </div>
            )}

            {visibleVerde.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-eyebrow text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Tenemos
                </div>
                <ul className="mt-2 space-y-1.5">
                  {visibleVerde.map((k) => renderKpi(k, "success"))}
                </ul>
              </div>
            )}

            {visibleRojo.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-eyebrow text-destructive">
                  <XCircle className="h-3.5 w-3.5" /> Faltan
                </div>
                <ul className="mt-2 space-y-1.5">
                  {visibleRojo.map((k) => renderKpi(k, "destructive"))}
                </ul>
              </div>
            )}

            {visibleNaranja.length === 0 && visibleVerde.length === 0 && visibleRojo.length === 0 && (
              <div className="text-xs italic text-muted-foreground">
                No hay KPIs pendientes · todos cubiertos.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

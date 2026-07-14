import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Play, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Job = {
  key: string;
  label: string;
  fn: string;
  body?: Record<string, unknown>;
  desc: string;
  cost: "alto" | "medio" | "bajo";
};

const JOBS: Job[] = [
  { key: "reprocess", label: "Reprocesar cartera (cohorte 77)", fn: "reprocess-cohort-77", body: { batch: 10 }, desc: "Re-analiza con VLM los edificios pendientes. Lanzar una vez; se auto-trocea.", cost: "alto" },
  { key: "windows", label: "Recontar ventanas (cal9)", fn: "recount-windows-cal9", body: { limit: 50 }, desc: "Recuenta ventanas de fachada con el campeón actual.", cost: "alto" },
  { key: "facade-v2", label: "Recontar ventanas fachada v2 (VLM)", fn: "count-facade-windows-v2", body: { limit: 25 }, desc: "VLM multi-captura para fachadas dudosas.", cost: "alto" },
  { key: "refetch-sv", label: "Re-capturar fotos Street View (cohorte 77)", fn: "batch-refetch-streetview-cohort77", desc: "Vuelve a pedir las 4 fotos SV de los 77 con la lógica corregida (sin el espejo +180°).", cost: "medio" },
  { key: "transcribe", label: "Transcribir llamadas pendientes (calls · Deepgram)", fn: "transcribe_call", desc: "Deepgram sobre tabla calls (sesiones copiloto).", cost: "alto" },
  { key: "transcribe-hs", label: "Transcribir llamadas HubSpot (OpenRouter · lote)", fn: "transcribe_calls", body: { limit: 15, chain: true }, desc: "STT OpenRouter (gpt-4o-mini-transcribe, fallback whisper-1) sobre hubspot_calls con grabación ≥45s y sin transcripción. Encadena en background hasta agotar los ~1.272 pendientes. Guarda en hs_call_transcription para alimentar KPIs y Voss.", cost: "alto" },
  { key: "analyze", label: "Analizar llamadas pendientes", fn: "analyze_call", desc: "Scoring/análisis LLM de llamadas con transcripción.", cost: "alto" },
  { key: "learn", label: "Aprender de llamadas (playbook)", fn: "learn_from_calls", desc: "Actualiza call_playbook a partir de llamadas analizadas.", cost: "medio" },
  { key: "embeddings", label: "Generar embeddings pendientes", fn: "generate_embeddings", desc: "Embeddings para knowledge_chunks sin vector.", cost: "medio" },
  { key: "coach", label: "Informe coach semanal", fn: "generate_coach_report", desc: "Reporte LLM para el equipo.", cost: "medio" },
  { key: "sync-calls", label: "Re-sincronizar llamadas HubSpot → sesiones", fn: "sync_hubspot_calls_to_sessions", desc: "Cierra sesiones abiertas vinculándolas a llamadas HS. Puede disparar voss_coach (LLM) si hay sesiones que cerrar.", cost: "medio" },
  { key: "enrich", label: "Iniciar enriquecimiento", fn: "enrichment-pipeline-start", desc: "Pipeline de enriquecimiento HubSpot.", cost: "medio" },
  { key: "detect-dh", label: "Detectar división horizontal", fn: "detect_division_horizontal", body: { max_buildings: 500 }, desc: "Marca buildings.division_horizontal=true cuando hay ≥2 fincas registrales distintas en sus notas simples. Sin IA.", cost: "bajo" },
  { key: "recompute-cuotas", label: "Recalcular cuotas de propietarios", fn: "recompute_building_owner_cuotas", body: { max_buildings: 500 }, desc: "Corrige building_owners.cuota: NULL en edificios DH (la verdad está por finca) y derivada desde notas en los demás. Marca inconsistentes (Σ≠100%). Lanzar tras 'Detectar DH'.", cost: "bajo" },
  { key: "escaleras-visor", label: "Detectar escaleras (Visor PG97)", fn: "escaleras-visor-madrid", body: { batch: true, only_protegidos: true, limit: 10 }, desc: "Lee el plano 'Análisis de la Edificación' del Catálogo PG97 (Visor Urbanístico Madrid) y cuenta cajas de escalera con VLM. Solo edificios protegidos. Validado a mano (Serrano 8 → 2, Conde de Peñalver 5 → 2). Bajo demanda.", cost: "alto" },
  { key: "wa-sync-hubspot", label: "Sincronizar WhatsApp → HubSpot (conversación)", fn: "wa_sync_hubspot", desc: "Vuelca a HubSpot el resumen + cualificación + flags de una conversación como nota engagement en el contacto del propietario, y actualiza hs_lead_status según el stage. Requiere conversation_id (úsalo desde el detalle de la conversación o pasa el UUID a mano).", cost: "bajo" },
  { key: "hubspot-sync-call-kpis", label: "Sincronizar Llamada → HubSpot (sesión copiloto)", fn: "hubspot_sync_call_kpis", desc: "Vuelca a HubSpot el cierre de una sesión del copiloto de llamada (resumen + checklist + Voss post) como nota engagement, actualiza propiedades afflux_* del contacto si existen, y mueve hs_lead_status. Requiere session_id; reporta propiedades afflux_* que falten por crear.", cost: "bajo" },
  { key: "wa-match-backfill", label: "Identificar contactos WA → propietarios BD", fn: "wa_match_backfill", body: { limit: 5000 }, desc: "Recorre wa_contacts sin lead_id y los cruza con owners.telefono. Si hay match único, asocia el owner y guarda los edificios en metadata.matched_buildings (visible en el panel de WhatsApp). Marca 'ambiguous' si varios owners comparten el teléfono.", cost: "bajo" },
  { key: "fetch-iee-batch", label: "Refrescar IEE/ITE (lote)", fn: "fetch_iee_madrid_batch", body: { limit: 50 }, desc: "Consulta IEE/ITE en la sede del Ayto Madrid (vía Firecrawl + LLM) para edificios con iee_estado='desconocido' o consulta >90 días. Aplica fallback por antigüedad (>=30 años sin IEE → pendiente). Lote pequeño para no agotar créditos.", cost: "medio" },
];

export function JobsManualPanel() {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const run = async (job: Job) => {
    setBusy((s) => ({ ...s, [job.key]: true }));
    try {
      const { data, error } = await supabase.functions.invoke(job.fn, { body: job.body ?? {} });
      if (error) throw error;
      toast.success(`${job.label}: lanzado`, { description: typeof data === "object" ? JSON.stringify(data).slice(0, 160) : String(data ?? "OK") });
    } catch (e: any) {
      toast.error(`${job.label}: error`, { description: String(e?.message ?? e).slice(0, 200) });
    } finally {
      setBusy((s) => ({ ...s, [job.key]: false }));
    }
  };

  const costBadge = (c: Job["cost"]) => {
    const cls = c === "alto" ? "border-red-500/40 text-red-400" : c === "medio" ? "border-amber-500/40 text-amber-400" : "border-emerald-500/40 text-emerald-400";
    return <Badge variant="outline" className={cls}>{c.toUpperCase()}</Badge>;
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><Play className="mr-1 inline h-3 w-3" /> Jobs · Bajo demanda</Eyebrow>
        <CardTitle>Lanzar procesos manualmente</CardTitle>
        <p className="text-xs text-muted-foreground">
          Todo lo que consume IA se lanza desde aquí. Los cron automáticos de IA están deshabilitados para controlar gasto.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2">
          {JOBS.map((j) => (
            <div key={j.key} className="flex items-start justify-between gap-3 rounded border border-border/50 bg-surface-1 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{j.label}</span>
                  {costBadge(j.cost)}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{j.desc}</p>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy[j.key]} onClick={() => run(j)}>
                {busy[j.key] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                <span className="ml-1">Lanzar</span>
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
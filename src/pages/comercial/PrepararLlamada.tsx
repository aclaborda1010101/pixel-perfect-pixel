import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, Phone, CheckCircle2, Clock, XCircle, PhoneOff, Copy, AlertTriangle, Target, Users, Lightbulb, TrendingUp, Quote, MessageSquareWarning, ArrowRight, Clock4 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { VossCoachCard } from "@/components/comercial/VossCoachCard";
import { CallWizardStepper } from "@/components/comercial/CallWizardStepper";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiChecklistCard } from "@/components/comercial/KpiChecklistCard";
import { ContactHistoryCard } from "@/components/owners/ContactHistoryCard";

type Outcome = "interesado" | "no_interesa" | "volver" | "no_contesta";
const OUTCOMES: Array<{ key: Outcome; label: string; icon: any; variant: "success" | "outline" | "info" | "destructive" }> = [
  { key: "interesado", label: "Interesado", icon: CheckCircle2, variant: "success" },
  { key: "volver", label: "Volver a llamar", icon: Clock, variant: "info" },
  { key: "no_contesta", label: "No contesta", icon: PhoneOff, variant: "outline" },
  { key: "no_interesa", label: "No interesa", icon: XCircle, variant: "destructive" },
];

export default function ComercialPrepararLlamada() {
  const { ownerId } = useParams<{ ownerId: string }>();
  const [brief, setBrief] = useState<any | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [notas, setNotas] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [objetivo, setObjetivo] = useState<string>("reunion");
  const [finalizing, setFinalizing] = useState(false);
  const [puntuacion, setPuntuacion] = useState<number | null>(null);
  const [vossPost, setVossPost] = useState<any | null>(null);
  // Espera activa a transcripción de HubSpot tras pulsar "Llamada finalizada"
  const [awaiting, setAwaiting] = useState<{ nextAt: number; attempt: number } | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [targetKpis, setTargetKpis] = useState<string[]>([]);
  const [kpiContext, setKpiContext] = useState<Array<{ clave: string; label: string; estado: "tenemos" | "a_medias" | "falta"; evidencia: string | null }>>([]);
  const [targetKpiClaves, setTargetKpiClaves] = useState<string[]>([]);
  const [postKpiContext, setPostKpiContext] = useState<Array<{ clave: string; label: string; estado: "tenemos" | "a_medias" | "falta"; evidencia: string | null }> | null>(null);
  const [scheduledAnalyzeAt, setScheduledAnalyzeAt] = useState<number | null>(null);
  const DEFAULT_CHECKLIST = [
    { k: "tipologia", label: "Tipología del propietario (T1–T10 / buyer persona)" },
    { k: "motor", label: "Qué le mueve (dinero, paz, herederos, miedo, control)" },
    { k: "info_edificio", label: "Info edificio / copropietarios / alquileres" },
    { k: "canal_abierto", label: "Canal abierto (WhatsApp opt-in / mail / influenciador)" },
  ];
  const [checklist, setChecklist] = useState<Array<{ k: string; label: string; done: boolean; evidencia?: string | null; auto_done?: boolean }>>(
    DEFAULT_CHECKLIST.map((c) => ({ ...c, done: false })),
  );

  const { data } = useQuery({
    queryKey: ["comercial:preparar", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const [{ data: owner }, { data: history }, { data: ownerScoreRows }] = await Promise.all([
        supabase.from("owners").select("*").eq("id", ownerId!).maybeSingle(),
        supabase.from("calls").select("id,fecha,resumen,direccion").eq("owner_id", ownerId!).order("fecha", { ascending: false }).limit(5),
        (supabase.from("v_owner_score" as any) as any)
          .select("*")
          .eq("owner_id", ownerId!)
          .order("score", { ascending: false, nullsFirst: false }),
      ]);
      // El propietario puede aparecer en varios edificios (p. ej. pleno + nuda propiedad);
      // nos quedamos con el de mayor score para mostrar la mejor oportunidad.
      const ownerScore = Array.isArray(ownerScoreRows) && ownerScoreRows.length > 0 ? ownerScoreRows[0] : null;
      const buildingId = (ownerScore as any)?.building_id;
      let building = null;
      if (buildingId) {
        const { data: b } = await (supabase.from("v_building_score" as any) as any).select("*").eq("id", buildingId).maybeSingle();
        building = b;
      }
      // Cargas/embargos de nota simple
      let cargas: any[] = [];
      const { data: nota } = await supabase.from("notas_simples").select("structured_json").eq("owner_id", ownerId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (nota?.structured_json && typeof nota.structured_json === "object") {
        cargas = (nota.structured_json as any).cargas ?? [];
      }
      return { owner: owner as any, history: history as any[], ownerScore: ownerScore as any, building: building as any, cargas };
    },
  });

  async function loadBrief() {
    if (!ownerId) return;
    setLoadingBrief(true);
    try {
      const buildingId = data?.ownerScore?.building_id;
      const { data: res, error } = await supabase.functions.invoke("agent_voss_coach", {
        body: { mode: "brief", owner_id: ownerId, building_id: buildingId, target_kpis: targetKpis, kpi_context: kpiContext },
      });
      if (error) throw error;
      setBrief(res);
      if (sessionId) await persistSession({ voss_brief: (res as any)?.voss ?? res });
      // Persistir en caché de preparación para no regenerar en futuras visitas
      try {
        const { data: laRaw } = await (supabase.rpc as any)("owner_last_activity_at", { _owner_id: ownerId });
        await (supabase.from("owner_call_prep_cache" as any) as any).upsert({
          owner_id: ownerId,
          brief_json: (res as any)?.voss ?? res,
          brief_generated_at: new Date().toISOString(),
          brief_last_activity_at: (laRaw as any) ?? null,
          brief_model: "agent_voss_coach",
        }, { onConflict: "owner_id" });
      } catch { /* best-effort */ }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar el briefing");
    } finally {
      setLoadingBrief(false);
    }
  }

  useEffect(() => { setBrief(null); }, [ownerId]);

  // Cargar KPIs a abordar → los pasamos al brief para que se enfoque en esos datos concretos.
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: res } = await supabase.functions.invoke("agent_kpi_checklist", {
          body: { owner_id: ownerId },
        });
        if (cancelled || !res) return;
        const kpis = (res as any).kpis as Array<{ clave: string; label: string }> | undefined;
        const aAbordar = ((res as any).a_abordar ?? []) as string[];
        const set = new Set(aAbordar);
        const labels = (kpis ?? [])
          .filter((k) => set.has(k.clave))
          .map((k) => k.label);
        setTargetKpis(labels);
        setTargetKpiClaves(aAbordar);
        // Guarda TODO el checklist (tenemos + a_medias + falta con evidencia) para alimentar el brief.
        const full = ((res as any).kpis ?? []) as Array<{ clave: string; label: string; estado: any; evidencia: string | null }>;
        setKpiContext(full.map((k) => ({ clave: k.clave, label: k.label, estado: k.estado, evidencia: k.evidencia ?? null })));
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  // Crear/cargar session al entrar
  useEffect(() => {
    if (!ownerId) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      const { data: existing } = await (supabase.from("call_sessions" as any) as any)
        .select("*").eq("comercial_id", uid).eq("owner_id", ownerId).neq("estado", "finalizada")
        .order("iniciada_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        setSessionId(existing.id);
        setPaso((existing.paso ?? 1) as 1|2|3);
        if (existing.objetivo) setObjetivo(existing.objetivo);
        if (Array.isArray(existing.checklist) && existing.checklist.length) setChecklist(existing.checklist);
        if (existing.notas) setNotas(existing.notas);
        if (existing.voss_brief) setBrief({ voss: existing.voss_brief });
        if (existing.voss_post) setVossPost(existing.voss_post);
        if (existing.puntuacion != null) setPuntuacion(Number(existing.puntuacion));
      } else {
        const { data: ins } = await (supabase.from("call_sessions" as any) as any)
          .insert({
            comercial_id: uid, owner_id: ownerId, paso: 1, objetivo: "reunion",
            estado: "preparada",
            iniciada_at: new Date().toISOString(),
            checklist: DEFAULT_CHECKLIST.map((c) => ({ ...c, done: false })),
          })
          .select("id").maybeSingle();
        if (ins) {
          setSessionId((ins as any).id);
          // El VossCoachCard hace auto-carga desde caché (o genera si no hay).
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  async function persistSession(patch: Record<string, any>) {
    if (!sessionId) return;
    await (supabase.from("call_sessions" as any) as any).update(patch).eq("id", sessionId);
  }

  function toggleCheck(k: string) {
    setChecklist((curr) => {
      const next = curr.map((c) => (c.k === k ? { ...c, done: !c.done } : c));
      persistSession({ checklist: next });
      return next;
    });
  }

  function jumpTo(n: number) {
    if (n < 1 || n > 3) return;
    setPaso(n as 1|2|3);
    persistSession({ paso: n });
  }

  async function finalizeCall() {
    if (!sessionId) return;
    setFinalizing(true);
    try {
      await tryFinalizeOnce({ pullHubspot: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Error finalizando llamada");
    } finally {
      setFinalizing(false);
    }
  }

  // Calendario de reintentos si la transcripción aún no ha aterrizado.
  // Al pulsar "Continuar llamada" programamos auto-análisis a ~15 min.
  const RETRY_DELAYS_MS = [120_000, 180_000, 300_000];
  const AUTO_ANALYZE_DELAY_MS = 15 * 60 * 1000;

  async function tryFinalizeOnce({ pullHubspot }: { pullHubspot: boolean }): Promise<boolean> {
    if (!sessionId) return false;
    if (pullHubspot) {
      // Pull activo de Calls desde HubSpot (best-effort, no bloquea más de unos segundos)
      try {
        await supabase.functions.invoke("hubspot_sync_engagements", {
          body: { types: ["calls"], max_pages: 2, background: false },
        });
      } catch { /* best-effort */ }
    }
    const { data: res, error } = await supabase.functions.invoke("finalize_call_session", {
      body: { session_id: sessionId },
    });
    if (error) throw error;
    if ((res as any)?.ok === false) {
      // No hay transcripción todavía: programa siguiente reintento si quedan
      const attempt = (awaiting?.attempt ?? 0);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay != null) {
        const nextAt = Date.now() + delay;
        setAwaiting({ nextAt, attempt: attempt + 1 });
        toast.message("Esperando transcripción de HubSpot…", {
          description: `Reintento automático en ${Math.round(delay / 1000)} s (intento ${attempt + 1}/${RETRY_DELAYS_MS.length}).`,
        });
      } else {
        setAwaiting(null);
        toast.error("Sin transcripción tras 5 min. La sesión queda en espera; se reintentará por el sync automático.");
      }
      return false;
    }
    // OK
    setAwaiting(null);
    toast.success(`Llamada analizada · score ${(res as any)?.puntuacion ?? "—"}/100`);
    if (Array.isArray((res as any)?.checks)) setChecklist((res as any).checks);
    if ((res as any)?.puntuacion != null) setPuntuacion(Number((res as any).puntuacion));
    const { data: refreshed } = await (supabase.from("call_sessions" as any) as any)
      .select("voss_post, notas").eq("id", sessionId).maybeSingle();
    if (refreshed?.voss_post) setVossPost(refreshed.voss_post);
    if (refreshed?.notas) setNotas(refreshed.notas);
    setPaso(3);
    // Cancelar auto-análisis pendiente y refrescar KPIs conseguidos.
    setScheduledAnalyzeAt(null);
    refreshKpisPostCall();
    return true;
  }

  // Deep link a HubSpot + programar auto-análisis a 15 min al pulsar "Continuar".
  async function goToCallStep() {
    if (!ownerId) return;
    jumpTo(2);
    try {
      const { data: eid } = await supabase.from("external_ids")
        .select("provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot")
        .eq("entity_id", ownerId).maybeSingle();
      const contactId = (eid as any)?.provider_id;
      if (contactId) {
        let portalId = localStorage.getItem("hs_portal_id");
        if (!portalId) {
          try {
            const { data: pj } = await supabase.functions.invoke("hubspot_ping", { body: {} });
            const p = (pj as any)?.portal_id;
            if (p) { portalId = String(p); localStorage.setItem("hs_portal_id", portalId); }
          } catch { /* best-effort */ }
        }
        const url = portalId
          ? `https://app.hubspot.com/contacts/${portalId}/record/0-1/${contactId}`
          : `https://app.hubspot.com/contacts/list/view/all/?query=${encodeURIComponent(String(contactId))}`;
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        toast.message("Sin contacto HubSpot vinculado a este propietario");
      }
    } catch { /* best-effort */ }
    const at = Date.now() + AUTO_ANALYZE_DELAY_MS;
    setScheduledAnalyzeAt(at);
    toast.success("Llamada abierta en HubSpot · analizaré automáticamente en 15 min");
  }

  // Re-computar KPIs tras la llamada e invalidar caché de preparación.
  async function refreshKpisPostCall() {
    if (!ownerId) return;
    try {
      await (supabase.from("owner_call_prep_cache" as any) as any)
        .update({ kpis_last_activity_at: new Date().toISOString() })
        .eq("owner_id", ownerId);
      const { data: res } = await supabase.functions.invoke("agent_kpi_checklist", { body: { owner_id: ownerId } });
      if (!res) return;
      const kpis = ((res as any).kpis ?? []) as Array<{ clave: string; label: string; estado: any; evidencia: string | null }>;
      setPostKpiContext(kpis.map((k) => ({ clave: k.clave, label: k.label, estado: k.estado, evidencia: k.evidencia ?? null })));
    } catch { /* best-effort */ }
  }

  // Tick del countdown + disparo del reintento cuando llega su momento
  useEffect(() => {
    if (!awaiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [awaiting]);

  useEffect(() => {
    if (!awaiting) return;
    if (now < awaiting.nextAt) return;
    // Ejecutar reintento
    (async () => {
      try { await tryFinalizeOnce({ pullHubspot: true }); }
      catch (e: any) { toast.error(e?.message ?? "Error en reintento"); setAwaiting(null); }
    })();
    // El propio tryFinalizeOnce reprograma el siguiente o limpia awaiting.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, awaiting?.nextAt]);

  // Tick + disparo del auto-análisis programado a 15 min tras "Continuar llamada".
  useEffect(() => {
    if (!scheduledAnalyzeAt) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [scheduledAnalyzeAt]);

  useEffect(() => {
    if (!scheduledAnalyzeAt || finalizing || awaiting) return;
    if (now < scheduledAnalyzeAt) return;
    setScheduledAnalyzeAt(null);
    (async () => { try { await finalizeCall(); } catch {} })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, scheduledAnalyzeAt]);

  // Normaliza esquema viejo y nuevo a un mismo shape
  const normalizedBrief = (() => {
    if (!brief) return null;
    const b = (brief as any).brief ?? brief;
    if (b.openers || b.intencion_llamada) return b; // nuevo
    return {
      modo: "primer_contacto",
      confianza: b.confianza ?? 0.5,
      resumen: b.contexto ?? b.resumen ?? "",
      estado_relacion: "—",
      intencion_llamada: (b.objetivos?.[0]) ?? "",
      mejor_momento: null,
      openers: [],
      preguntas_clave: b.preguntas_clave ?? [],
      objeciones: [],
      tips: (b.objetivos ?? []).map((t: string) => ({ tipo: "buena_practica", texto: t })),
      riesgos: b.riesgos ?? [],
      proxima_accion: b.proxima_accion_sugerida ?? b.proxima_accion ?? "",
      contexto_peers: null,
    };
  })();

  async function submitResult() {
    if (!outcome || !ownerId) return;
    setSubmitting(true);
    try {
      // 1. Insert call
      // Bloque A · escribir los flags KPI del doc Afflux para que la vista
      // v_kpis_comercial_semana deje de contar 0.
      const reunionCerrada = objetivo === "reunion" && outcome === "interesado";
      const callMetadatos: Record<string, unknown> = {
        objetivo,
        whatsapp_enviado: objetivo === "whatsapp" || undefined,
        pixel_enviado: objetivo === "pixel" || undefined,
        reunion_cerrada: reunionCerrada || undefined,
      };
      const { data: callRow, error: callErr } = await supabase.from("calls").insert({
        owner_id: ownerId,
        fecha: new Date().toISOString(),
        direccion: "saliente",
        resumen: notas || `Resultado: ${outcome}`,
        outcome,
        notas_post_llamada: notas,
        metadatos: Object.fromEntries(Object.entries(callMetadatos).filter(([, v]) => v !== undefined)) as any,
      }).select("id").maybeSingle();
      if (callErr) throw callErr;
      if (sessionId) {
        await persistSession({
          resultado: outcome, notas, call_id: callRow?.id ?? null, paso: 3, cerrada_at: new Date().toISOString(),
        });
      }

      // 2. Auto-seguimiento según outcome
      const nextDate = new Date();
      if (outcome === "interesado") nextDate.setDate(nextDate.getDate() + 2);
      else if (outcome === "volver" || outcome === "no_contesta") nextDate.setDate(nextDate.getDate() + 5);
      else nextDate.setDate(nextDate.getDate() + 30);

      if (outcome !== "no_interesa") {
        await supabase.from("next_actions").insert({
          titulo: outcome === "interesado" ? "Llamada de avance" : "Reintentar contacto",
          owner_id: ownerId,
          origen: "comercial_post_call",
          vencimiento: nextDate.toISOString().slice(0, 10),
        });
      }

      // 3. Quality score y oportunidades vía analyze_call (best-effort)
      if (callRow?.id) {
        supabase.functions.invoke("analyze_call", { body: { call_id: callRow.id, chain: false } }).catch(() => {});
      }

      // 4. Push KPIs a HubSpot (best-effort). Necesita session_id para resolver el contacto.
      if (sessionId) {
        supabase.functions.invoke("hubspot_sync_call_kpis", { body: { session_id: sessionId } }).catch(() => {});
      }

      toast.success("Resultado registrado · próximo paso programado");
      setOutcome(null);
      setNotas("");
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando resultado");
    } finally {
      setSubmitting(false);
    }
  }

  const owner = data?.owner;
  const building = data?.building;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<><Link to="/comercial" className="hover:text-gold">Cartera</Link> · Preparar llamada</>}
        title={owner?.nombre ?? "Propietario"}
        subtitle={building ? `${building.direccion} · ${building.ciudad ?? ""}` : ""}
        actions={
          <Button variant="gold" size="sm" onClick={loadBrief} disabled={loadingBrief}>
            <Sparkles className="h-4 w-4" />
            {loadingBrief ? "Generando…" : brief ? "Regenerar briefing" : "Briefing IA"}
          </Button>
        }
      />

      <CallWizardStepper paso={paso} onJump={jumpTo} />

      {paso === 1 && (
      <>
      {/* Briefing IA */}
      {loadingBrief && !brief && <BriefSkeleton />}

      {/* KPIs · qué tenemos / qué falta (motor IA sobre notas reales) */}
      {ownerId && <KpiChecklistCard ownerId={ownerId} />}

      {/* Historial de contacto (llamadas + resultados) */}
      {ownerId && <ContactHistoryCard ownerId={ownerId} />}

      {/* Coach Voss · pre-llamada (plan completo con datos reales) */}
      {ownerId && (
        <VossCoachCard
          ownerId={ownerId}
          buildingId={data?.ownerScore?.building_id}
          mode="brief"
          targetKpis={targetKpis}
          kpiContext={kpiContext}
          initialVoss={(brief as any)?.voss ?? null}
          onLoaded={(v) => { setBrief({ voss: v }); if (sessionId) persistSession({ voss_brief: v }); }}
        />
      )}
        <div className="flex justify-end">
          <Button variant="gold" onClick={goToCallStep}>
            <Phone className="h-4 w-4" /> Continuar llamada <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </>
      )}

      {paso === 2 && (
        <Card>
          <CardHeader>
            <Eyebrow>Durante la llamada</Eyebrow>
            <CardTitle>Guía táctica · Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono uppercase tracking-eyebrow text-muted-foreground">Objetivo:</span>
              {[{ k: "reunion", label: "Reunión" }, { k: "whatsapp", label: "Enviar WhatsApp" }, { k: "pixel", label: "Enviar pixel" }].map((o) => (
                <Button key={o.k} size="sm" variant={objetivo === o.k ? "gold" : "outline"} onClick={() => { setObjetivo(o.k); persistSession({ objetivo: o.k }); }}>
                  {o.label}
                </Button>
              ))}
            </div>
            <ul className="space-y-2">
              {checklist.map((c) => (
                <li key={c.k} className="flex items-start gap-3 rounded-[4px] border border-border-faint bg-surface-1/30 p-3">
                  <Checkbox checked={c.done} onCheckedChange={() => toggleCheck(c.k)} className="mt-0.5" />
                  <div className="flex-1">
                    <div className={c.done ? "text-muted-foreground line-through" : "text-foreground"}>{c.label}</div>
                    {c.evidencia && (
                      <div className="mt-1 rounded border-l-2 border-gold/40 bg-surface-1/40 px-2 py-1 text-xs italic text-muted-foreground">
                        "{c.evidencia}"
                      </div>
                    )}
                  </div>
                  {c.auto_done && <Badge variant="gold" className="text-[10px]">auto</Badge>}
                </li>
              ))}
            </ul>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => jumpTo(1)}>Volver al brief</Button>
              <Button variant="gold" onClick={finalizeCall} disabled={finalizing || !!awaiting}>
                <PhoneOff className="h-4 w-4" />
                {finalizing ? "Analizando llamada…" : awaiting ? "Esperando transcripción…" : "Llamada finalizada · analizar"}
              </Button>
            </div>
            {awaiting && (
              <div className="rounded border border-gold/40 bg-gold-soft/20 p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Clock4 className="h-3.5 w-3.5 text-gold" />
                    <span className="font-mono uppercase tracking-eyebrow text-muted-foreground">
                      Esperando transcripción de HubSpot
                    </span>
                  </div>
                  <div className="font-mono text-foreground">
                    Reintento en {Math.max(0, Math.ceil((awaiting.nextAt - now) / 1000))} s · intento {awaiting.attempt}/{RETRY_DELAYS_MS.length}
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button size="sm" variant="outline" onClick={async () => {
                    setAwaiting({ nextAt: Date.now(), attempt: awaiting.attempt });
                    try { await tryFinalizeOnce({ pullHubspot: true }); } catch {}
                  }}>Reintentar ahora</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {paso === 3 && (
      <>
      {puntuacion != null && (
        <Card>
          <CardHeader>
            <Eyebrow>Análisis Voss · automático</Eyebrow>
            <CardTitle>Puntuación: <span className="font-mono text-gold">{puntuacion}/100</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {vossPost?.puntuacion?.justificacion && (
              <p className="text-foreground">{vossPost.puntuacion.justificacion}</p>
            )}
            <ul className="space-y-1.5">
              {checklist.map((c) => (
                <li key={c.k} className="flex items-start gap-2">
                  {c.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                  <div className="flex-1">
                    <div className="text-foreground">{c.label}</div>
                    {c.evidencia && (
                      <div className="mt-0.5 italic text-xs text-muted-foreground">"{c.evidencia}"</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {vossPost?.proxima_accion && (
              <div className="rounded border border-gold/30 bg-gold-soft/20 p-2 text-xs">
                <span className="font-mono uppercase tracking-eyebrow text-muted-foreground">Próxima acción:</span> {vossPost.proxima_accion}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {/* Post-call */}
      <Card>
        <CardHeader><Eyebrow>Post-llamada</Eyebrow><CardTitle>Registrar resultado</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <Button key={o.key} type="button" variant={outcome === o.key ? "gold" : "outline"} onClick={() => setOutcome(o.key)}>
                <o.icon className="h-4 w-4" /> {o.label}
              </Button>
            ))}
          </div>
          <Textarea
            placeholder="Notas (opcional): puntos discutidos, próximos pasos, objeciones, etc."
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={4}
          />
          <div className="flex justify-end">
            <Button variant="gold" onClick={submitResult} disabled={!outcome || submitting}>
              {submitting ? "Guardando…" : "Registrar y programar seguimiento"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {ownerId && (
        <VossCoachCard
          ownerId={ownerId}
          buildingId={data?.ownerScore?.building_id}
          mode="post"
          transcript={notas}
        />
      )}
      </>
      )}
    </div>
  );
}

type Brief = {
  modo: "con_historico" | "primer_contacto";
  confianza: number;
  resumen: string;
  estado_relacion: string;
  intencion_llamada: string;
  mejor_momento: { franja: string; razon: string } | null;
  openers: string[];
  preguntas_clave: string[];
  objeciones: { objecion: string; respuesta: string }[];
  tips: { tipo: "historico" | "patron_peers" | "buena_practica"; texto: string }[];
  riesgos: string[];
  proxima_accion: string;
  contexto_peers: string | null;
};

function BriefSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Eyebrow><Sparkles className="mr-1 inline h-3 w-3" /> Briefing IA</Eyebrow>
        <CardTitle>Generando playbook…</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </CardContent>
    </Card>
  );
}

function ConfidenceDots({ value }: { value: number }) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 4);
  return (
    <div className="flex items-center gap-1" title={`Confianza ${(value * 100).toFixed(0)}%`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-4 rounded-sm ${i < filled ? "bg-gold" : "bg-border-faint"}`}
        />
      ))}
      <span className="ml-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function TipIcon({ tipo }: { tipo: Brief["tips"][number]["tipo"] }) {
  if (tipo === "historico") return <TrendingUp className="h-3.5 w-3.5 text-gold" />;
  if (tipo === "patron_peers") return <Users className="h-3.5 w-3.5 text-info" />;
  return <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />;
}

function tipLabel(tipo: Brief["tips"][number]["tipo"]) {
  return tipo === "historico" ? "Histórico" : tipo === "patron_peers" ? "Peers del edificio" : "Buena práctica";
}

function BriefView({ brief }: { brief: Brief }) {
  const copy = (txt: string) => {
    navigator.clipboard.writeText(txt).then(
      () => toast.success("Copiado"),
      () => toast.error("No se pudo copiar"),
    );
  };
  return (
    <Card className="border-gold/30">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow><Sparkles className="mr-1 inline h-3 w-3 text-gold" /> Briefing IA</Eyebrow>
          <div className="flex items-center gap-3">
            <Badge variant={brief.modo === "con_historico" ? "gold" : "info"}>
              {brief.modo === "con_historico" ? "Con histórico" : "Primer contacto"}
            </Badge>
            <ConfidenceDots value={brief.confianza ?? 0} />
          </div>
        </div>
        <CardTitle className="text-lg font-editorial leading-snug">{brief.resumen}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {brief.intencion_llamada && (
            <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-gold/40 bg-gold-soft/40 px-2 py-1 font-mono uppercase tracking-eyebrow text-gold">
              <Target className="h-3 w-3" /> {brief.intencion_llamada}
            </span>
          )}
          {brief.estado_relacion && brief.estado_relacion !== "—" && (
            <span className="rounded-[4px] border border-border-faint bg-surface-1/40 px-2 py-1 font-mono uppercase tracking-eyebrow text-muted-foreground">
              Relación: {brief.estado_relacion}
            </span>
          )}
          {brief.mejor_momento && (
            <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-border-faint bg-surface-1/40 px-2 py-1 font-mono uppercase tracking-eyebrow text-foreground">
              <Clock4 className="h-3 w-3" /> {brief.mejor_momento.franja}
              <span className="normal-case tracking-normal text-muted-foreground">· {brief.mejor_momento.razon}</span>
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Openers */}
          {brief.openers.length > 0 && (
            <section>
              <Eyebrow className="mb-2">Aperturas sugeridas</Eyebrow>
              <ul className="space-y-2">
                {brief.openers.map((o, i) => (
                  <li key={i} className="group relative rounded-[6px] border border-gold/20 bg-gold-soft/20 p-3 text-sm leading-relaxed text-foreground">
                    <Quote className="absolute right-2 top-2 h-3 w-3 text-gold/50" />
                    <p className="pr-6">{o}</p>
                    <button
                      onClick={() => copy(o)}
                      className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground hover:text-gold"
                    >
                      <Copy className="h-3 w-3" /> Copiar
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Preguntas clave */}
          {brief.preguntas_clave.length > 0 && (
            <section>
              <Eyebrow className="mb-2">Preguntas clave</Eyebrow>
              <ol className="space-y-1.5 text-sm">
                {brief.preguntas_clave.map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono text-[11px] text-gold">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-foreground">{q}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* Objeciones */}
        {brief.objeciones.length > 0 && (
          <section>
            <Eyebrow className="mb-2"><MessageSquareWarning className="mr-1 inline h-3 w-3" /> Objeciones probables</Eyebrow>
            <Accordion type="single" collapsible className="rounded-[6px] border border-border-faint">
              {brief.objeciones.map((o, i) => (
                <AccordionItem value={`obj-${i}`} key={i} className="border-b border-border-faint last:border-0">
                  <AccordionTrigger className="px-3 py-2 text-left text-sm">
                    <span className="text-foreground">«{o.objecion}»</span>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 text-sm text-muted-foreground">
                    <span className="font-mono text-[10px] uppercase tracking-eyebrow text-gold">Cómo responder · </span>
                    {o.respuesta}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        )}

        {/* Tips */}
        {brief.tips.length > 0 && (
          <section>
            <Eyebrow className="mb-2">Tips para esta llamada</Eyebrow>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {brief.tips.map((t, i) => (
                <li key={i} className="flex gap-2 rounded-[6px] border border-border-faint bg-surface-1/30 p-3 text-sm">
                  <span className="mt-0.5"><TipIcon tipo={t.tipo} /></span>
                  <div className="flex-1">
                    <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{tipLabel(t.tipo)}</div>
                    <div className="text-foreground">{t.texto}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Riesgos */}
        {brief.riesgos.length > 0 && (
          <section>
            <Eyebrow className="mb-2"><AlertTriangle className="mr-1 inline h-3 w-3 text-destructive" /> Riesgos</Eyebrow>
            <ul className="space-y-1.5 text-sm">
              {brief.riesgos.map((r, i) => (
                <li key={i} className="flex gap-2 rounded-[4px] border border-destructive/20 bg-destructive/5 px-3 py-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Contexto peers */}
        {brief.contexto_peers && (
          <section className="rounded-[6px] border border-info/30 bg-info/5 p-3 text-sm">
            <Eyebrow className="mb-1"><Users className="mr-1 inline h-3 w-3" /> Contexto del edificio</Eyebrow>
            <p className="text-foreground">{brief.contexto_peers}</p>
          </section>
        )}

        {/* Próxima acción */}
        {brief.proxima_accion && (
          <div className="flex items-center gap-3 rounded-[6px] border border-gold/40 bg-gold-soft/40 p-3">
            <ArrowRight className="h-4 w-4 text-gold" />
            <div className="flex-1">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Próxima acción</div>
              <div className="text-sm text-foreground">{brief.proxima_accion}</div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
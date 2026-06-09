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
  const DEFAULT_CHECKLIST = [
    { k: "saludo", label: "Saludo + identificación de Afflux" },
    { k: "interes", label: "Preguntar por interés en venta/asesoría" },
    { k: "situacion", label: "Indagar situación (herencia, propiedad, %)" },
    { k: "dolor", label: "Detectar dolor / motivo de inacción" },
    { k: "valor", label: "Anclar valor estimado de su parte" },
    { k: "cierre", label: "Pedir compromiso (reunión / WhatsApp / pixel)" },
  ];
  const [checklist, setChecklist] = useState<Array<{ k: string; label: string; done: boolean }>>(
    DEFAULT_CHECKLIST.map((c) => ({ ...c, done: false })),
  );

  const { data } = useQuery({
    queryKey: ["comercial:preparar", ownerId],
    enabled: !!ownerId,
    queryFn: async () => {
      const [{ data: owner }, { data: history }, { data: ownerScore }] = await Promise.all([
        supabase.from("owners").select("*").eq("id", ownerId!).maybeSingle(),
        supabase.from("calls").select("id,fecha,resumen,direccion").eq("owner_id", ownerId!).order("fecha", { ascending: false }).limit(5),
        (supabase.from("v_owner_score" as any) as any).select("*").eq("owner_id", ownerId!).maybeSingle(),
      ]);
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
      const { data, error } = await supabase.functions.invoke("agent_pre_call_brief", {
        body: { owner_id: ownerId, locale: "es" },
      });
      if (error) throw error;
      setBrief(data);
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo generar el briefing");
    } finally {
      setLoadingBrief(false);
    }
  }

  useEffect(() => { setBrief(null); }, [ownerId]);

  // Crear/cargar session al entrar
  useEffect(() => {
    if (!ownerId) return;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      const { data: existing } = await (supabase.from("call_sessions" as any) as any)
        .select("*").eq("comercial_id", uid).eq("owner_id", ownerId).is("cerrada_at", null)
        .order("iniciada_at", { ascending: false }).limit(1).maybeSingle();
      if (existing) {
        setSessionId(existing.id);
        setPaso((existing.paso ?? 1) as 1|2|3);
        if (existing.objetivo) setObjetivo(existing.objetivo);
        if (Array.isArray(existing.checklist) && existing.checklist.length) setChecklist(existing.checklist);
        if (existing.notas) setNotas(existing.notas);
      } else {
        const { data: ins } = await (supabase.from("call_sessions" as any) as any)
          .insert({ comercial_id: uid, owner_id: ownerId, paso: 1, objetivo: "reunion", checklist: DEFAULT_CHECKLIST.map((c)=>({...c,done:false})) })
          .select("id").maybeSingle();
        if (ins) setSessionId((ins as any).id);
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
      const { data: callRow, error: callErr } = await supabase.from("calls").insert({
        owner_id: ownerId,
        fecha: new Date().toISOString(),
        direccion: "saliente",
        resumen: notas || `Resultado: ${outcome}`,
        outcome,
        notas_post_llamada: notas,
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Resumen edificio */}
        <Card>
          <CardHeader><Eyebrow>Edificio · Oportunidad</Eyebrow><CardTitle>Resumen</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Score</span><span className="font-mono text-gold">{Number(building?.score ?? 0).toFixed(0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">m² totales</span><span className="font-mono">{building?.m2_total ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Viviendas</span><span className="font-mono">{building?.num_viviendas ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">División horizontal</span><Badge variant={building?.division_horizontal ? "outline" : "gold"}>{building?.division_horizontal ? "Sí" : "No"}</Badge></div>
          </CardContent>
        </Card>

        {/* Datos propietario */}
        <Card>
          <CardHeader><Eyebrow>Propietario</Eyebrow><CardTitle>Ficha</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">% propiedad</span><span className="font-mono text-gold">{data?.ownerScore?.pct_propiedad != null ? `${Number(data.ownerScore.pct_propiedad).toFixed(1)}%` : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Teléfono</span><span className="font-mono">{owner?.telefono ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Contactos previos</span><span className="font-mono">{data?.ownerScore?.contactos_previos ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cargas / embargos</span><span className="font-mono">{(data?.cargas ?? []).length}</span></div>
            {owner?.telefono && (
              <a href={`tel:${owner.telefono}`} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[4px] border border-gold/40 bg-gold-soft/40 px-3 py-2 font-mono text-[11px] uppercase tracking-eyebrow text-gold hover:bg-gold-soft/60">
                <Phone className="h-3.5 w-3.5" /> Llamar ahora
              </a>
            )}
          </CardContent>
        </Card>

        {/* Historial */}
        <Card>
          <CardHeader><Eyebrow>Interacciones previas</Eyebrow><CardTitle>Últimas {data?.history?.length ?? 0}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(data?.history ?? []).length === 0 && <p className="text-muted-foreground">Sin llamadas registradas.</p>}
            {(data?.history ?? []).map((h) => (
              <div key={h.id} className="rounded border border-border-faint p-2">
                <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{new Date(h.fecha).toLocaleString()}</div>
                <div className="line-clamp-2 text-foreground">{h.resumen ?? "—"}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Briefing IA */}
      {loadingBrief && !brief && <BriefSkeleton />}
      {normalizedBrief && <BriefView brief={normalizedBrief} />}

      {/* Coach Voss · pre-llamada */}
      {ownerId && (
        <VossCoachCard
          ownerId={ownerId}
          buildingId={data?.ownerScore?.building_id}
          mode="brief"
        />
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
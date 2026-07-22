import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, XCircle, FileText, ArrowLeft, ArrowDownLeft, ArrowUpRight } from "lucide-react";

function fmtDateTime(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDur(s?: number | null) {
  if (!s || s <= 0) return "—";
  let secs = s;
  if (secs > 14400) secs = Math.round(secs / 1000);
  const m = Math.floor(secs / 60);
  const r = secs % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}
function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export default function CallExpediente() {
  const { hsId = "" } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [building, setBuilding] = useState<any>(null);
  const [hsCall, setHsCall] = useState<any>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcriptDiarized, setTranscriptDiarized] = useState(false);

  useEffect(() => {
    if (!hsId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: s } = await (supabase.from("call_sessions" as any) as any)
        .select("*")
        .eq("hubspot_call_id", hsId)
        .eq("estado", "finalizada")
        .order("finalizada_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setSession(s ?? null);

      const [ownerRes, hsRes] = await Promise.all([
        (s as any)?.owner_id
          ? supabase.from("owners").select("id, nombre").eq("id", (s as any).owner_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("hubspot_calls" as any).select("hs_id, hs_timestamp, hs_call_duration, hs_call_direction, hs_call_disposition, hs_call_body, hs_call_summary, hs_call_transcription").eq("hs_id", hsId).maybeSingle(),
      ]);
      if (cancelled) return;
      setOwner((ownerRes as any).data ?? null);
      const hc = (hsRes as any).data ?? null;
      setHsCall(hc);
      const rawTx: string = hc?.hs_call_transcription ?? "";
      setTranscriptDiarized(typeof rawTx === "string" && rawTx.trim().startsWith("["));
      setTranscript(stripHtml(rawTx || hc?.hs_call_summary || hc?.hs_call_body));

      if ((s as any)?.building_id) {
        const { data: b } = await supabase.from("buildings").select("id, direccion").eq("id", (s as any).building_id).maybeSingle();
        if (!cancelled) setBuilding(b ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hsId]);

  const voss: any = session?.voss_post ?? {};
  const puntuacion = session?.puntuacion ?? voss?.puntuacion?.score_0_100 ?? null;
  const justificacion = voss?.puntuacion?.justificacion ?? null;
  const desglose = voss?.puntuacion?.desglose ?? null;
  const resumenEjecutivo: string = voss?.resumen_ejecutivo ?? "";
  const desarrollo: Array<{ titulo: string; sintesis: string; citas?: string[] }> = Array.isArray(voss?.desarrollo) ? voss.desarrollo : [];
  const inteligencia: Array<{ dato: string; categoria?: string; cita?: string; confianza?: string }> = Array.isArray(voss?.inteligencia_extraida) ? voss.inteligencia_extraida : [];
  // Nueva forma: evaluacion_comercial.{que_hizo_bien, que_mejorar}
  // Retro-compat: voss.que_hizo_bien[] / voss.momentos_flojos[]
  const evalBien: Array<{ momento?: string; tecnica_voss?: string; comentario?: string }> =
    Array.isArray(voss?.evaluacion_comercial?.que_hizo_bien) ? voss.evaluacion_comercial.que_hizo_bien
    : Array.isArray(voss?.que_hizo_bien) ? voss.que_hizo_bien : [];
  const evalMejorar: Array<{ momento?: string; que_paso?: string; alternativa_literal?: string; mejora_voss?: string; tecnica?: string }> =
    Array.isArray(voss?.evaluacion_comercial?.que_mejorar) ? voss.evaluacion_comercial.que_mejorar
    : Array.isArray(voss?.momentos_flojos) ? voss.momentos_flojos : [];
  const proximaAccion: string = voss?.proxima_accion ?? "";
  const sacar: string[] = Array.isArray(voss?.sacar_en_siguiente_contacto) ? voss.sacar_en_siguiente_contacto : [];
  const informeCompleto: boolean = voss?.informe_completo !== false && (desarrollo.length + inteligencia.length + evalBien.length + evalMejorar.length) > 0;

  const kpisObjetivoLabels: string[] = (() => {
    const ko = session?.kpis_objetivo;
    if (!ko) return [];
    if (Array.isArray(ko)) return ko as string[];
    if (Array.isArray((ko as any).labels)) return (ko as any).labels as string[];
    if (Array.isArray((ko as any).claves)) return (ko as any).claves as string[];
    return [];
  })();
  const checklist: Array<{ k?: string; label?: string; done?: boolean; auto_done?: boolean; evidencia?: string | null }> =
    Array.isArray(session?.checklist) ? (session!.checklist as any) : [];

  const fecha = session?.finalizada_at ?? session?.cerrada_at ?? hsCall?.hs_timestamp;
  const direccion = hsCall?.hs_call_direction ?? null;
  const resultado = session?.resultado ?? hsCall?.hs_call_disposition ?? null;
  const duracion = hsCall?.hs_call_duration ?? null;

  return (
    <div className="w-full min-w-0 space-y-6">
      <Crumbs items={[{ label: "Llamadas", to: "/llamadas" }, { label: owner?.nombre ?? "Expediente" }]} />
      <PageHeader
        eyebrow="Expediente de llamada"
        title={owner?.nombre ? `${owner.nombre}` : "Expediente"}
        subtitle={
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <FileText className="h-3 w-3 text-primary" />
            <span>{fmtDateTime(fecha)}</span>
            <span>·</span>
            <span>{fmtDur(duracion)}</span>
            {direccion && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                {String(direccion).toUpperCase() === "INBOUND" ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                {String(direccion).toUpperCase() === "INBOUND" ? "Entrante" : "Saliente"}
              </Badge>
            )}
            {resultado && <Badge variant="outline" className="text-[10px]">{resultado}</Badge>}
            {owner && (
              <Link to={`/propietarios/${owner.id}`} className="ml-2 underline hover:text-foreground">
                Ficha propietario →
              </Link>
            )}
            {building && (
              <Link to={`/comercial/edificios/${building.id}`} className="underline hover:text-foreground">
                {building.direccion} →
              </Link>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {puntuacion != null && (
              <Badge className="rounded-[4px] bg-gold-soft/40 text-gold border-transparent font-mono">
                {Number(puntuacion)}/100
              </Badge>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-3 w-3" /> Volver
            </Button>
          </div>
        }
      />

      {loading && <div className="text-sm text-muted-foreground">Cargando expediente…</div>}
      {!loading && !session && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta llamada aún no tiene análisis. El análisis automático se ejecuta ~15 min después de finalizada.
        </CardContent></Card>
      )}

      {session && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <Eyebrow>Objetivo</Eyebrow>
              <CardTitle className="text-base">{session.objetivo ?? "—"}</CardTitle>
            </CardHeader>
          </Card>

          {kpisObjetivoLabels.length > 0 && (
            <Card>
              <CardHeader><Eyebrow>KPIs fijados para esta llamada</Eyebrow></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {kpisObjetivoLabels.map((label, i) => {
                    const claves = Array.isArray((session.kpis_objetivo as any)?.claves) ? (session.kpis_objetivo as any).claves : [];
                    const clave = claves[i];
                    const item = checklist.find((c) => c.k === clave);
                    const done = Boolean(item?.done || item?.auto_done);
                    return (
                      <li key={i} className="flex items-start gap-2">
                        {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                        <div className="flex-1">
                          <div>{label}</div>
                          {done && item?.evidencia && <div className="italic text-xs text-muted-foreground">"{item.evidencia}"</div>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {checklist.length > 0 && (
            <Card>
              <CardHeader><Eyebrow>Conseguidos en esta llamada</Eyebrow></CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {(c.done || c.auto_done) ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />}
                      <div className="flex-1">
                        <div>{c.label}</div>
                        {c.evidencia && <div className="italic text-xs text-muted-foreground">"{c.evidencia}"</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {resumenEjecutivo && (
            <Card className="lg:col-span-2 border-primary/30">
              <CardHeader>
                <Eyebrow>Resumen ejecutivo</Eyebrow>
                {!informeCompleto && (
                  <Badge variant="outline" className="w-fit text-[10px]">Informe breve · llamada corta o sin contenido</Badge>
                )}
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{resumenEjecutivo}</p>
              </CardContent>
            </Card>
          )}

          {desarrollo.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader><Eyebrow>Desarrollo de la llamada</Eyebrow></CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {desarrollo.map((t, i) => (
                    <AccordionItem key={i} value={`d${i}`}>
                      <AccordionTrigger className="text-sm font-medium">
                        <span className="text-left">{i + 1}. {t.titulo}</span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2 text-sm">
                        <p className="text-foreground/90">{t.sintesis}</p>
                        {Array.isArray(t.citas) && t.citas.length > 0 && (
                          <ul className="space-y-1.5 border-l-2 border-border-faint pl-3">
                            {t.citas.map((c, j) => (
                              <li key={j} className="italic text-xs text-muted-foreground">"{c}"</li>
                            ))}
                          </ul>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}

          {inteligencia.length > 0 && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <Eyebrow>Inteligencia extraída · {inteligencia.length} datos</Eyebrow>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {inteligencia.map((d, i) => (
                    <li key={i} className="rounded-md border border-border-faint p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-foreground">{d.dato}</span>
                        {d.categoria && <Badge variant="outline" className="shrink-0 text-[10px]">{d.categoria}</Badge>}
                      </div>
                      {d.cita && <p className="mt-1 italic text-xs text-muted-foreground">"{d.cita}"</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {(justificacion || evalBien.length > 0 || evalMejorar.length > 0 || desglose) && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <Eyebrow>Evaluación del comercial · auditoría VOSS</Eyebrow>
                <CardTitle className="text-base">
                  {puntuacion != null ? <>Nota <span className="font-mono">{Number(puntuacion)}/100</span></> : "Análisis"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm">
                {justificacion && <p className="text-foreground/90">{justificacion}</p>}

                {desglose && (
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    {(["rapport", "extraccion_info", "avance_deal", "cierre_canal"] as const).map((k) => {
                      const d: any = (desglose as any)?.[k];
                      if (!d) return null;
                      const label = k === "rapport" ? "Rapport" : k === "extraccion_info" ? "Extracción" : k === "avance_deal" ? "Avance" : "Cierre / canal";
                      return (
                        <div key={k} className="rounded-md border border-border-faint p-2.5">
                          <Eyebrow>{label}</Eyebrow>
                          <div className="mt-1 font-mono text-lg tabular-nums">{d.score_0_100 ?? "—"}<span className="text-xs text-muted-foreground">/100</span></div>
                          {d.justificacion && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{d.justificacion}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {evalBien.length > 0 && (
                  <div>
                    <div className="mb-1.5 uppercase tracking-eyebrow text-[10px] text-emerald-600">Qué hizo bien</div>
                    <ul className="space-y-2">
                      {evalBien.map((b, i) => (
                        <li key={i} className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                          {b.tecnica_voss && <Badge variant="outline" className="mb-1 text-[10px]">{b.tecnica_voss}</Badge>}
                          {b.momento && <p className="italic text-xs text-muted-foreground">"{b.momento}"</p>}
                          {b.comentario && <p className="mt-1 text-xs text-foreground/90">{b.comentario}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {evalMejorar.length > 0 && (
                  <div>
                    <div className="mb-1.5 uppercase tracking-eyebrow text-[10px] text-amber-500">Qué mejorar</div>
                    <ul className="space-y-2">
                      {evalMejorar.map((m, i) => (
                        <li key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5">
                          {m.tecnica && <Badge variant="outline" className="mb-1 text-[10px]">{m.tecnica}</Badge>}
                          {m.momento && <p className="italic text-xs text-muted-foreground">"{m.momento}"</p>}
                          {m.que_paso && <p className="mt-1 text-xs text-foreground/90">{m.que_paso}</p>}
                          {(m.alternativa_literal || m.mejora_voss) && (
                            <p className="mt-1.5 border-l-2 border-primary/60 pl-2 text-xs text-foreground">
                              <span className="mr-1 font-semibold text-primary">Debería haber dicho:</span>
                              "{m.alternativa_literal ?? m.mejora_voss}"
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(proximaAccion || sacar.length > 0) && (
            <Card className="lg:col-span-2 border-gold/40">
              <CardHeader>
                <Eyebrow>Propuesta para la siguiente llamada</Eyebrow>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {proximaAccion && <p>{proximaAccion}</p>}
                {sacar.length > 0 && (
                  <ul className="ml-4 list-disc space-y-0.5">{sacar.map((s, i) => <li key={i}>{s}</li>)}</ul>
                )}
                {owner && (
                  <div className="pt-2">
                    <Button asChild size="sm" variant="gold">
                      <Link to={`/comercial/preparar/${owner.id}`}>Preparar siguiente llamada →</Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(() => {
            // Notas humanas del comercial (hs_call_body de HubSpot).
            // El resumen máquina antiguo NO se muestra aquí — ya vive en las
            // secciones de auditoría (Resumen ejecutivo / Evaluación).
            const humanNotes = stripHtml(hsCall?.hs_call_body);
            const looksMachine = /score\s*:\s*\d/i.test(humanNotes) || /el comercial (maneja|realiza|logra)/i.test(humanNotes);
            if (!humanNotes || looksMachine) return null;
            return (
              <Card className="lg:col-span-2">
                <CardHeader><Eyebrow>Notas del comercial</Eyebrow></CardHeader>
                <CardContent className="whitespace-pre-wrap text-sm">{humanNotes}</CardContent>
              </Card>
            );
          })()}

          {transcript && (
            <Card className="lg:col-span-2">
              <CardContent className="pt-6">
                <Accordion type="single" collapsible>
                  <AccordionItem value="t">
                    <AccordionTrigger className="text-xs uppercase tracking-eyebrow text-muted-foreground">
                      <span className="flex items-center gap-2">
                        Transcripción / cuerpo de la llamada
                        {transcriptDiarized ? (
                          <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 text-[10px]">
                            Transcripción diarizada (HubSpot)
                          </Badge>
                        ) : hsCall?.hs_call_transcription ? (
                          <Badge variant="outline" className="text-[10px]">STT</Badge>
                        ) : null}
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <p className="whitespace-pre-wrap text-sm text-foreground/90">{transcript}</p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
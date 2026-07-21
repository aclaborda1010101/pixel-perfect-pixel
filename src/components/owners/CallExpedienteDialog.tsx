import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, FileText } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

type ExpedienteSession = {
  id: string;
  owner_id: string;
  building_id: string | null;
  hubspot_call_id: string | null;
  objetivo: string | null;
  resultado: string | null;
  puntuacion: number | null;
  finalizada_at: string | null;
  cerrada_at: string | null;
  kpis_objetivo: any;
  checklist: any;
  voss_brief: any;
  voss_post: any;
  notas: string | null;
};

function fmtDateTime(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function stripHtml(input: string | null | undefined): string {
  if (!input) return "";
  return String(input).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

export function CallExpedienteDialog({
  sessionId,
  hubspotCallId,
  open,
  onOpenChange,
}: {
  sessionId?: string | null;
  hubspotCallId?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [session, setSession] = useState<ExpedienteSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!sessionId && !hubspotCallId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSession(null);
      setTranscript(null);
      let q: any = (supabase.from("call_sessions" as any) as any).select("*").eq("estado", "finalizada");
      if (sessionId) q = q.eq("id", sessionId);
      else if (hubspotCallId) q = q.eq("hubspot_call_id", hubspotCallId);
      const { data } = await q.order("finalizada_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      setSession((data as any) ?? null);
      const hsId = (data as any)?.hubspot_call_id ?? hubspotCallId;
      if (hsId) {
        const { data: hc } = await supabase
          .from("hubspot_calls" as any)
          .select("hs_call_transcription, hs_call_body, hs_call_summary")
          .eq("hs_id", hsId)
          .maybeSingle();
        const t = (hc as any)?.hs_call_transcription || (hc as any)?.hs_call_summary || (hc as any)?.hs_call_body || null;
        if (!cancelled) setTranscript(stripHtml(t));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, sessionId, hubspotCallId]);

  const voss = session?.voss_post ?? {};
  const puntuacion = session?.puntuacion ?? (voss as any)?.puntuacion?.score_0_100 ?? null;
  const justificacion = (voss as any)?.puntuacion?.justificacion ?? null;
  const bien: string[] = Array.isArray((voss as any)?.que_bien) ? (voss as any).que_bien : [];
  const mal: string[] = Array.isArray((voss as any)?.que_mal) ? (voss as any).que_mal : [];
  const mejoras: string[] = Array.isArray((voss as any)?.mejoras) ? (voss as any).mejoras : [];
  const proximaAccion: string = (voss as any)?.proxima_accion ?? "";
  const sacar: string[] = Array.isArray((voss as any)?.sacar_en_siguiente_contacto) ? (voss as any).sacar_en_siguiente_contacto : [];

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <Eyebrow>Expediente de llamada</Eyebrow>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            {fmtDateTime(session?.finalizada_at ?? session?.cerrada_at)}
            {puntuacion != null && (
              <Badge className="ml-auto rounded-[4px] bg-gold-soft/40 text-gold border-transparent font-mono">
                {Number(puntuacion)}/100
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && <div className="text-sm text-muted-foreground">Cargando expediente…</div>}
        {!loading && !session && (
          <div className="text-sm text-muted-foreground">No hay expediente para esta llamada.</div>
        )}

        {session && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-4 text-xs">
              <div>
                <div className="uppercase tracking-eyebrow text-muted-foreground text-[10px]">Objetivo</div>
                <div className="font-medium">{session.objetivo ?? "—"}</div>
              </div>
              <div>
                <div className="uppercase tracking-eyebrow text-muted-foreground text-[10px]">Resultado</div>
                <div className="font-medium">{session.resultado ?? "—"}</div>
              </div>
            </div>

            {kpisObjetivoLabels.length > 0 && (
              <div>
                <Eyebrow>KPIs objetivo (fijados antes de la llamada)</Eyebrow>
                <ul className="mt-2 space-y-1.5">
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
                          {done && item?.evidencia && (
                            <div className="italic text-xs text-muted-foreground">"{item.evidencia}"</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {checklist.length > 0 && (
              <div>
                <Eyebrow>Todos los KPIs capturados en esta llamada</Eyebrow>
                <ul className="mt-2 space-y-1.5">
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
              </div>
            )}

            {(justificacion || bien.length > 0 || mal.length > 0 || mejoras.length > 0) && (
              <div>
                <Eyebrow>Auditoría VOSS</Eyebrow>
                {justificacion && <p className="mt-2">{justificacion}</p>}
                {bien.length > 0 && (
                  <div className="mt-3">
                    <div className="uppercase tracking-eyebrow text-[10px] text-emerald-600">Qué se hizo bien</div>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5">{bien.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {mal.length > 0 && (
                  <div className="mt-3">
                    <div className="uppercase tracking-eyebrow text-[10px] text-destructive">Qué se hizo mal</div>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5">{mal.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {mejoras.length > 0 && (
                  <div className="mt-3">
                    <div className="uppercase tracking-eyebrow text-[10px] text-muted-foreground">Mejoras</div>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5">{mejoras.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {(proximaAccion || sacar.length > 0) && (
              <div>
                <Eyebrow>Propuesta para la siguiente llamada</Eyebrow>
                {proximaAccion && <p className="mt-2">{proximaAccion}</p>}
                {sacar.length > 0 && (
                  <ul className="ml-4 mt-2 list-disc space-y-0.5">{sacar.map((s, i) => <li key={i}>{s}</li>)}</ul>
                )}
              </div>
            )}

            {session.notas && (
              <div>
                <Eyebrow>Notas</Eyebrow>
                <p className="mt-2 whitespace-pre-wrap">{session.notas}</p>
              </div>
            )}

            {transcript && (
              <Accordion type="single" collapsible>
                <AccordionItem value="t">
                  <AccordionTrigger className="text-xs uppercase tracking-eyebrow text-muted-foreground">
                    Transcripción / cuerpo de la llamada
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="whitespace-pre-wrap text-sm text-foreground/90">{transcript}</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
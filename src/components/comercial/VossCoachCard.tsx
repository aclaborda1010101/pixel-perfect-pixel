import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Quote, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function VossCoachCard({
  ownerId,
  buildingId,
  mode = "brief" as "brief" | "post",
  transcript,
  autoload,
  initialVoss,
  onLoaded,
  targetKpis,
  kpiContext,
}: {
  ownerId?: string;
  buildingId?: string;
  mode?: "brief" | "post";
  transcript?: string;
  autoload?: boolean;
  initialVoss?: any;
  onLoaded?: (voss: any) => void;
  targetKpis?: string[];
  kpiContext?: Array<{ clave: string; label: string; estado: "tenemos" | "a_medias" | "falta"; evidencia: string | null }>;
}) {
  const [voss, setVoss] = useState<any>(initialVoss ?? null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<"cache" | "fresh" | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [lastActivityAt, setLastActivityAt] = useState<string | null>(null);

  useEffect(() => { if (initialVoss) setVoss(initialVoss); }, [initialVoss]);
  // Auto-carga desde caché (o regenera) al montar / cambiar owner, solo en modo brief
  useEffect(() => {
    if (!ownerId || mode !== "brief") return;
    if (initialVoss) return; // ya viene precargado de la sesión
    let cancelled = false;
    (async () => { if (!cancelled) await load(false); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, mode]);
  useEffect(() => {
    if (autoload && !voss && ownerId && mode !== "brief") load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoload, ownerId]);

  async function load(force = false) {
    setBusy(true);
    try {
      // Solo cacheamos el brief; el modo post-llamada siempre se regenera.
      if (mode === "brief" && ownerId) {
        const { data: laRaw } = await (supabase.rpc as any)("owner_last_activity_at", { _owner_id: ownerId });
        const la: string | null = (laRaw as any) ?? null;
        setLastActivityAt(la);
        if (!force) {
          const { data: cache } = await (supabase.from("owner_call_prep_cache" as any) as any)
            .select("brief_json, brief_generated_at, brief_last_activity_at")
            .eq("owner_id", ownerId)
            .maybeSingle();
          const gen = (cache as any)?.brief_generated_at;
          const stillValid = gen && (!la || new Date(la).getTime() <= new Date(gen).getTime());
          if (cache && (cache as any).brief_json && stillValid) {
            const v = (cache as any).brief_json;
            setVoss(v);
            setGeneratedAt(gen);
            setSource("cache");
            onLoaded?.(v);
            setBusy(false);
            return;
          }
        }
      }

      const { data, error } = await supabase.functions.invoke("agent_voss_coach", {
        body: { mode, owner_id: ownerId, building_id: buildingId, call_transcript: transcript, target_kpis: targetKpis, kpi_context: kpiContext },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const v = (data as any).voss;
      setVoss(v);
      onLoaded?.(v);
      if (mode === "brief" && ownerId) {
        const nowIso = new Date().toISOString();
        setGeneratedAt(nowIso);
        setSource("fresh");
        await (supabase.from("owner_call_prep_cache" as any) as any).upsert({
          owner_id: ownerId,
          brief_json: v,
          brief_generated_at: nowIso,
          brief_last_activity_at: lastActivityAt,
          brief_model: "agent_voss_coach",
        }, { onConflict: "owner_id" });
      }
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar el plan Voss");
    } finally { setBusy(false); }
  }

  const guion = voss?.guion ?? null;
  const ctx = voss?.contexto_propietario ?? null;
  const hist = voss?.historico ?? null;
  const info = voss?.info_minima_a_extraer ?? null;
  const playbook = Array.isArray(voss?.playbook_priorizado) ? voss.playbook_priorizado : [];
  const enfoque = Array.isArray(voss?.enfoque_llamada) ? voss.enfoque_llamada : [];
  const plan = Array.isArray(voss?.plan_llamada) ? voss.plan_llamada : [];
  const comoEnfocar: string = typeof voss?.como_enfocar === "string" ? voss.como_enfocar : "";
  const hilo = Array.isArray(voss?.hilo) ? voss.hilo : [];
  const lineasRojas: string[] = Array.isArray(voss?.lineas_rojas) ? voss.lineas_rojas : [];
  const cierreFerrero: string = typeof voss?.cierre === "string" ? voss.cierre : "";
  const checklistPost = voss?.checklist ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <Eyebrow><Quote className="mr-1 inline h-3 w-3" /> Coach Voss</Eyebrow>
          <CardTitle className="flex items-center gap-2">
            <span>{mode === "brief" ? "Plan de llamada · Voss" : "Análisis post-llamada"}</span>
            {mode === "brief" && voss?.header && (
              <Badge variant={String(voss.header).startsWith("Primer") ? "outline" : "gold"} className="text-[10px]">
                {voss.header}
              </Badge>
            )}
          </CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={() => load(true)} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {voss ? "Regenerar" : "Generar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!voss && !busy && <p className="text-muted-foreground">Pulsa Generar para obtener el plan de llamada concreto.</p>}
        {busy && !voss && <p className="text-muted-foreground inline-flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Generando plan…</p>}
        {voss && mode === "brief" && generatedAt && (
          <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground">
            {source === "cache"
              ? `Preparación generada el ${new Date(generatedAt).toLocaleString("es-ES")} · sin cambios desde entonces`
              : `Actualizada${lastActivityAt ? ` por actividad del ${new Date(lastActivityAt).toLocaleDateString("es-ES")}` : ""} · ${new Date(generatedAt).toLocaleString("es-ES")}`}
          </div>
        )}

        {voss && mode === "brief" && (
          <>
            {comoEnfocar && (
              <div className="rounded-[6px] border border-gold/60 bg-gold-soft/20 p-3">
                <div className="mb-1 text-[10px] font-mono uppercase tracking-eyebrow text-gold">Cómo enfocar esta llamada</div>
                <p className="text-foreground whitespace-pre-line">{comoEnfocar}</p>
              </div>
            )}
            {plan.length > 0 && (
              <div className="rounded-[6px] border-2 border-gold bg-gold-soft/30 p-3">
                <div className="mb-2 text-[10px] font-mono uppercase tracking-eyebrow text-gold">
                  📞 Plan para esta llamada
                </div>
                <ol className="space-y-2">
                  {plan.map((p: any, i: number) => (
                    <li key={i} className="rounded border border-gold/40 bg-background/60 p-2">
                      <div className="flex items-start gap-2">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[11px] font-semibold text-background">{i + 1}</span>
                        <div className="flex-1 space-y-1">
                          <div className="font-medium text-foreground">{p.paso}</div>
                          {p.como && (
                            <div className="italic text-muted-foreground">→ "{p.como}"</div>
                          )}
                          <div className="flex flex-wrap gap-1 pt-1">
                            {p.kpi_objetivo && (
                              <Badge variant="gold" className="text-[10px]">KPI: {p.kpi_objetivo}</Badge>
                            )}
                            {p.por_que && (
                              <Badge variant="outline" className="text-[10px]">porque: {p.por_que}</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {enfoque.length > 0 && (
              <div className="rounded-[6px] border border-gold/50 bg-gold-soft/25 p-3">
                <div className="mb-2 text-[10px] font-mono uppercase tracking-eyebrow text-gold">
                  🎯 Enfoque de esta llamada · KPIs a conseguir
                </div>
                <ul className="space-y-2">
                  {enfoque.map((e: any, i: number) => (
                    <li key={i} className="rounded border border-gold/30 bg-background/40 p-2">
                      <div className="font-medium text-foreground">{e.kpi}</div>
                      {e.pregunta_o_tactica && (
                        <div className="mt-1 italic text-muted-foreground">→ "{e.pregunta_o_tactica}"</div>
                      )}
                      {e.tecnica && (
                        <div className="mt-1 text-[10px] font-mono uppercase tracking-eyebrow text-gold">{e.tecnica}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ctx && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Quién es</div>
                <p className="text-foreground">{ctx.quien_es}</p>
                {ctx.situacion_edificio && <p className="text-muted-foreground mt-1">{ctx.situacion_edificio}</p>}
                {Array.isArray(ctx.datos_faltantes) && ctx.datos_faltantes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ctx.datos_faltantes.map((d: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">falta: {d}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            {hist && (
              <div className="rounded border border-border-faint bg-surface-1/30 p-2">
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">{hist.tiene_historico ? "Histórico" : "Primer contacto"}</div>
                <p className="text-foreground">{hist.resumen}</p>
                {hist.punto_de_retoma && <p className="text-muted-foreground italic mt-1">→ {hist.punto_de_retoma}</p>}
              </div>
            )}
            {guion?.apertura_exacta && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Apertura · literal</div>
                <blockquote className="border-l-2 border-gold pl-3 italic text-foreground">"{guion.apertura_exacta}"</blockquote>
              </div>
            )}
            {Array.isArray(guion?.etiquetas) && guion.etiquetas.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Etiquetas Voss</div>
                <ul className="space-y-1">
                  {guion.etiquetas.map((e: string, i: number) => <li key={i} className="italic text-foreground">"{e}"</li>)}
                </ul>
              </div>
            )}
            {Array.isArray(guion?.preguntas_calibradas) && guion.preguntas_calibradas.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Preguntas calibradas</div>
                <ul className="space-y-1">
                  {guion.preguntas_calibradas.map((q: string, i: number) => <li key={i} className="text-foreground">• {q}</li>)}
                </ul>
              </div>
            )}
            {Array.isArray(guion?.objeciones_probables) && guion.objeciones_probables.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Objeciones probables</div>
                <ul className="space-y-2">
                  {guion.objeciones_probables.map((o: any, i: number) => (
                    <li key={i} className="rounded border border-border-faint p-2">
                      <div className="font-medium text-foreground">«{o.objecion}»</div>
                      <div className="text-muted-foreground italic">→ "{o.respuesta_voss}"</div>
                      {o.tecnica && <div className="mt-1 text-[10px] font-mono uppercase tracking-eyebrow text-gold">{o.tecnica}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {guion?.cierre_micro_compromiso && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Cierre · micro-compromiso</div>
                <blockquote className="border-l-2 border-emerald-500 pl-3 italic text-foreground">"{guion.cierre_micro_compromiso}"</blockquote>
              </div>
            )}
            {hilo.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">El hilo · frase + una pregunta</div>
                <ol className="space-y-2 list-decimal pl-4">
                  {hilo.map((h: any, i: number) => (
                    <li key={i} className="rounded border border-border-faint p-2">
                      {h.frase_confianza && <div className="italic text-muted-foreground">"{h.frase_confianza}"</div>}
                      {h.pregunta && <div className="mt-1 text-foreground">→ {h.pregunta}</div>}
                      {h.kpi_objetivo && <Badge variant="outline" className="mt-1 text-[10px]">KPI: {h.kpi_objetivo}</Badge>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {lineasRojas.length > 0 && (
              <div className="rounded border border-destructive/40 bg-destructive/5 p-2">
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-destructive mb-1">Líneas rojas · NO hagas esto</div>
                <ul className="space-y-0.5 text-foreground">
                  {lineasRojas.map((r: string, i: number) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
            {cierreFerrero && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Cierre · WhatsApp + especialista Afflux</div>
                <blockquote className="border-l-2 border-emerald-500 pl-3 italic text-foreground">"{cierreFerrero}"</blockquote>
              </div>
            )}
            {info && (
              <div className="rounded border border-gold/30 bg-gold-soft/20 p-2">
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-gold mb-1">Info mínima a extraer</div>
                <ul className="space-y-0.5 text-foreground">
                  {info.tipologia && <li>• <span className="font-medium">Tipología:</span> {info.tipologia}</li>}
                  {info.que_le_mueve && <li>• <span className="font-medium">Motor:</span> {info.que_le_mueve}</li>}
                  {Array.isArray(info.info_edificio) && info.info_edificio.map((x: string, i: number) => <li key={i}>• <span className="font-medium">Edificio:</span> {x}</li>)}
                  {info.canal_abierto && <li>• <span className="font-medium">Canal:</span> {info.canal_abierto}</li>}
                </ul>
              </div>
            )}
            {playbook.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Playbook · tácticas medidas</div>
                <ul className="space-y-1">
                  {playbook.map((p: any, i: number) => (
                    <li key={i} className="text-foreground">• <Badge variant="outline" className="mr-1 text-[10px]">{p.tipo}</Badge>{p.tactica} <span className="text-muted-foreground text-xs">· tasa {Math.round((p.tasa_exito ?? 0) * 100)}% (n={p.n_usos})</span></li>
                  ))}
                </ul>
              </div>
            )}
            {voss.por_que_funciona && <p className="text-muted-foreground"><span className="font-medium text-foreground">Por qué funciona:</span> {voss.por_que_funciona}</p>}
          </>
        )}

        {voss && mode === "post" && (
          <>
            {voss.puntuacion && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="gold">Score {voss.puntuacion.score_0_100}/100</Badge>
                <span className="text-muted-foreground">{voss.puntuacion.justificacion}</span>
              </div>
            )}
            {checklistPost && (
              <ul className="space-y-1">
                {Object.entries(checklistPost).map(([k, v]: any) => (
                  <li key={k} className="rounded border border-border-faint p-2">
                    <div className="text-foreground"><Badge variant={v.ok ? "gold" : "outline"} className="mr-1 text-[10px]">{v.ok ? "ok" : "—"}</Badge>{k}</div>
                    {v.evidencia && <div className="italic text-muted-foreground text-xs mt-1">"{v.evidencia}"</div>}
                  </li>
                ))}
              </ul>
            )}
            {Array.isArray(voss.momentos_flojos) && voss.momentos_flojos.length > 0 && (
              <div>
                <div className="text-[10px] font-mono uppercase tracking-eyebrow text-muted-foreground mb-1">Mejoras</div>
                <ul className="space-y-2">
                  {voss.momentos_flojos.map((m: any, i: number) => (
                    <li key={i} className="rounded border border-border-faint p-2">
                      <div className="italic text-muted-foreground">"{m.momento}"</div>
                      <div className="text-foreground mt-1">→ "{m.mejora_voss}" {m.tecnica && <span className="text-xs text-gold font-mono">· {m.tecnica}</span>}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {voss.proxima_accion && (
              <div className="rounded border border-gold/30 bg-gold-soft/20 p-2 text-foreground">
                <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Próxima acción · </span>{voss.proxima_accion}
              </div>
            )}
          </>
        )}

        {voss && Array.isArray(voss.fragmentos_usados) && voss.fragmentos_usados.length > 0 && (
          <details className="text-xs bg-muted/40 rounded p-2">
            <summary className="cursor-pointer">Fragmentos del corpus Voss</summary>
            <ul className="mt-2 space-y-1">
              {voss.fragmentos_usados.map((f: any, i: number) => (
                <li key={i}><Badge variant="outline" className="mr-1">{f.source}</Badge>{f.tecnica ? <span className="text-muted-foreground mr-1">[{f.tecnica}]</span> : null}{(f.snippet || "").slice(0, 240)}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
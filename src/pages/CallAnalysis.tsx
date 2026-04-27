import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, PhoneCall } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { Eyebrow } from "@/components/common/Eyebrow";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { RagSearch } from "@/components/agents/RagSearch";
import { toast } from "sonner";

export default function CallAnalysis() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [call, setCall] = useState<any>(null);
  const [owner, setOwner] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => {
    const { data: c } = await supabase.from("calls").select("*").eq("id", id).maybeSingle();
    setCall(c);
    if (c?.owner_id) {
      const { data: o } = await supabase.from("owners").select("*").eq("id", c.owner_id).maybeSingle();
      setOwner(o);
    }
  };
  useEffect(() => { if (id) load(); }, [id]);

  const runAnalyze = async () => {
    if (!call?.transcripcion && !note) {
      toast.error("No hay transcripción para analizar"); return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_analyze_note", {
        body: { owner_id: call.owner_id, texto: call.transcripcion ?? note },
      });
      if (error) throw error;
      const a = (data as any).analysis;
      setAnalysis(a);
      setActions([a.proxima_accion?.titulo].filter(Boolean));
      const resumen = [a.hechos?.[0], a.intenciones?.[0]].filter(Boolean).join(". ").slice(0, 500);
      await supabase.from("calls").update({ resumen }).eq("id", id);
      load();
      toast.success("Análisis completado");
    } catch (e: any) { toast.error(e?.message ?? "Error"); }
    finally { setRunning(false); }
  };

  const saveAction = async (titulo: string) => {
    const { error } = await supabase.from("next_actions").insert({
      owner_id: call.owner_id, titulo, origen: "call_analysis",
    });
    if (error) toast.error(error.message); else toast.success("Acción guardada");
  };

  if (!call) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="space-y-6">
      <Crumbs items={[{ label: "Llamadas", to: "/llamadas" }, { label: owner?.nombre ?? "Llamada" }]} />
      <PageHeader
        eyebrow="Llamada · Análisis"
        title={t.callAnalysis.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <PhoneCall className="h-3 w-3" />
            {owner ? (
              <Link to={`/propietarios/${owner.id}`} className="hover:text-foreground">{owner.nombre}</Link>
            ) : "—"}
            <span>·</span>
            <span>{new Date(call.fecha).toLocaleString()}</span>
            <span>·</span>
            <span>{call.duracion_seg ?? 0}s</span>
            <Badge variant="outline">{call.direccion}</Badge>
            {owner?.rol && <Badge variant="info">{owner.rol}</Badge>}
            <StatusBadge status={call.resumen ? "analyzed" : "no_summary"} />
          </span>
        }
        actions={
          <Button size="sm" variant="gold" onClick={runAnalyze} disabled={running}>
            {running && <Loader2 className="h-3 w-3 animate-spin" />}
            {t.callAnalysis.runAnalyze}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <Eyebrow>IA</Eyebrow>
              <CardTitle>{t.callAnalysis.summary}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {call.resumen ? (
                <p className="leading-relaxed text-foreground">{call.resumen}</p>
              ) : (
                <p className="text-muted-foreground">{t.callAnalysis.noSummary}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Eyebrow>Próximos pasos</Eyebrow>
              <CardTitle>{t.callAnalysis.actions}</CardTitle>
            </CardHeader>
            <CardContent>
              {analysis ? (
                <ol className="space-y-2 text-sm">
                  {[
                    analysis.proxima_accion?.titulo,
                    ...(analysis.intenciones ?? []).slice(0, 2),
                  ].filter(Boolean).map((act: string, i: number) => (
                    <li key={i} className="flex items-start justify-between gap-3 rounded-[6px] border border-border-faint bg-surface-1/30 p-3">
                      <span className="text-foreground"><span className="mr-2 font-mono text-xs text-gold">{i + 1}.</span>{act}</span>
                      <Button size="sm" variant="outline" onClick={() => saveAction(act)}>{t.callAnalysis.saveAction}</Button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">{t.callAnalysis.noSummary}</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <Tabs defaultValue="transcript" className="w-full">
            <CardHeader>
              <TabsList>
                <TabsTrigger value="transcript">{t.callAnalysis.tabsTranscript}</TabsTrigger>
                <TabsTrigger value="rag">{t.callAnalysis.tabsRag}</TabsTrigger>
                <TabsTrigger value="notes">{t.callAnalysis.tabsNotes}</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="transcript">
                {call.transcripcion ? (
                  <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">{call.transcripcion}</pre>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Sin transcripción guardada. Pega una para analizar:</p>
                    <Textarea rows={8} value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="rag">
                {call.owner_id && <RagSearch scopeType="owner" scopeId={call.owner_id} />}
              </TabsContent>
              <TabsContent value="notes">
                <p className="text-sm text-muted-foreground">Notas libres del agente (próximamente).</p>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

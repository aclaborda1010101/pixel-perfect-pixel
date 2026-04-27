import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/I18nProvider";
import { toast } from "sonner";

type Analysis = {
  hechos: string[];
  intenciones: string[];
  sentimiento: string;
  proxima_accion: { titulo: string; detalle?: string; vencimiento_dias?: number };
  hitl_required: boolean;
  motivo_hitl?: string;
  confianza: number;
};

export function AnalyzeNote({ ownerId }: { ownerId: string }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [a, setA] = useState<Analysis | null>(null);

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_analyze_note", {
        body: { owner_id: ownerId, texto: text, locale },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setA((data as any).analysis);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  };

  const saveAction = async () => {
    if (!a) return;
    const venc = a.proxima_accion.vencimiento_dias
      ? new Date(Date.now() + a.proxima_accion.vencimiento_dias * 86400_000)
          .toISOString()
          .slice(0, 10)
      : null;
    const { error } = await supabase.from("next_actions").insert({
      owner_id: ownerId,
      titulo: a.proxima_accion.titulo,
      detalle: a.proxima_accion.detalle ?? null,
      vencimiento: venc,
      origen: "agent_analyze_note",
    });
    if (error) toast.error(error.message);
    else toast.success("Acción guardada");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          {t.agents.analyzeNoteTitle}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={5}
          placeholder={t.agents.analyzeNotePlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button onClick={run} disabled={loading || !text.trim()}>
          {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {t.agents.analyzeNoteRun}
        </Button>
        {a && (
          <div className="space-y-3 text-sm">
            {a.hitl_required && (
              <div className="flex items-start gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <div>
                  <div className="font-medium">{t.agents.analyzeNoteReview}</div>
                  {a.motivo_hitl && <div className="text-xs">{a.motivo_hitl}</div>}
                </div>
              </div>
            )}
            <Block title={t.agents.analyzeNoteFacts}>
              <ul className="list-disc pl-5">{a.hechos.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </Block>
            <Block title={t.agents.analyzeNoteIntents}>
              <ul className="list-disc pl-5">{a.intenciones.map((h, i) => <li key={i}>{h}</li>)}</ul>
            </Block>
            <Block title={t.agents.analyzeNoteSentiment}>
              <Badge variant="outline">{a.sentimiento}</Badge>
            </Block>
            <Block title={t.agents.analyzeNoteAction}>
              <div>{a.proxima_accion.titulo}</div>
              {a.proxima_accion.detalle && (
                <div className="text-xs text-muted-foreground">{a.proxima_accion.detalle}</div>
              )}
              <Button size="sm" variant="outline" className="mt-2" onClick={saveAction}>
                {t.agents.analyzeNoteSaveAction}
              </Button>
            </Block>
            <div className="text-xs text-muted-foreground">
              {t.agents.preCallConfidence}: {(a.confianza * 100).toFixed(0)}%
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
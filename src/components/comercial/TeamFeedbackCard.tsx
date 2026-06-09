import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Mic, Square, Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Eyebrow } from "@/components/common/Eyebrow";

type Feedback = {
  id: string;
  building_id: string;
  autor_email: string | null;
  canal: "voz" | "texto";
  texto: string | null;
  audio_url: string | null;
  dimension: string | null;
  estado: string;
  analisis_ia: any;
  override_aplicado: any;
  created_at: string;
};

const estadoVariant: Record<string, any> = {
  nueva: "outline",
  analizada: "info",
  aplicada: "success",
  descartada: "outline",
  requiere_codigo: "destructive",
};

export function TeamFeedbackCard({ buildingId }: { buildingId: string }) {
  const { user } = useAuth();
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [texto, setTexto] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function load() {
    const { data } = await supabase
      .from("building_feedback")
      .select("*")
      .eq("building_id", buildingId)
      .order("created_at", { ascending: false });
    setFeedbacks((data as any) || []);
  }
  useEffect(() => { load(); }, [buildingId]);

  async function analyze(feedbackId: string) {
    try {
      await supabase.functions.invoke("agent_analyze_feedback", { body: { feedback_id: feedbackId } });
    } catch (e: any) {
      console.error("analyze error", e);
    } finally {
      load();
    }
  }

  async function submitTexto() {
    if (!texto.trim()) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("building_feedback")
        .insert({ building_id: buildingId, canal: "texto", texto: texto.trim(), autor_id: user?.id, autor_email: user?.email })
        .select("id")
        .single();
      if (error) throw error;
      setTexto("");
      toast.success("Observación enviada. Analizando…");
      await load();
      if (data?.id) await analyze(data.id);
    } catch (e: any) {
      toast.error(e?.message || "Error al enviar");
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await uploadAndCreate(blob);
      };
      mr.start();
      setRecording(true);
    } catch (e: any) {
      toast.error("No se pudo acceder al micrófono");
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  async function uploadAndCreate(blob: Blob) {
    setBusy(true);
    try {
      const path = `${buildingId}/${Date.now()}.webm`;
      const { error: upErr } = await supabase.storage.from("feedback-audio").upload(path, blob, { contentType: "audio/webm" });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("feedback-audio").createSignedUrl(path, 60 * 60 * 24 * 365);
      const { data: ins, error } = await supabase
        .from("building_feedback")
        .insert({ building_id: buildingId, canal: "voz", audio_url: signed?.signedUrl ?? path, texto: "(transcripción pendiente)", autor_id: user?.id, autor_email: user?.email })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Audio subido. Transcripción y análisis en curso…");
      await load();
      if (ins?.id) await analyze(ins.id);
    } catch (e: any) {
      toast.error(e?.message || "Error subiendo audio");
    } finally {
      setBusy(false);
    }
  }

  async function applyOverride(fb: Feedback) {
    setApplying(fb.id);
    try {
      const { data, error } = await supabase.functions.invoke("apply_feedback_override", { body: { feedback_id: fb.id, user_email: user?.email } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Override aplicado y recompute lanzado");
      load();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo aplicar");
    } finally {
      setApplying(null);
    }
  }

  async function descartar(fb: Feedback) {
    await supabase.from("building_feedback").update({ estado: "descartada" }).eq("id", fb.id);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Aprendizaje del sistema</Eyebrow>
        <CardTitle className="flex items-center gap-2">Correcciones del equipo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej: las escaleras son 2 (no 1) o este edificio no encaja en flex living porque las viviendas son muy grandes"
            rows={3}
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button onClick={submitTexto} disabled={busy || !texto.trim()} size="sm">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar observación
            </Button>
            {!recording ? (
              <Button variant="outline" size="sm" onClick={startRecording} disabled={busy}>
                <Mic className="h-4 w-4" /> Grabar voz
              </Button>
            ) : (
              <Button variant="destructive" size="sm" onClick={stopRecording}>
                <Square className="h-4 w-4" /> Detener
              </Button>
            )}
          </div>
        </div>

        {feedbacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay correcciones para este edificio.</p>
        ) : (
          <ul className="space-y-3">
            {feedbacks.map((fb) => {
              const accion = fb.analisis_ia?.accion;
              return (
                <li key={fb.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-muted-foreground">
                      {new Date(fb.created_at).toLocaleString()} · {fb.autor_email || "anónimo"} · {fb.canal}
                    </div>
                    <div className="flex items-center gap-1">
                      {fb.dimension && <Badge variant="outline">{fb.dimension}</Badge>}
                      <Badge variant={estadoVariant[fb.estado] || "outline"}>{fb.estado}</Badge>
                    </div>
                  </div>
                  <p className="text-sm">{fb.texto}</p>
                  {fb.audio_url && (
                    <audio controls src={fb.audio_url} className="w-full h-8" />
                  )}
                  {fb.analisis_ia && (
                    <details className="text-xs bg-muted/40 rounded p-2">
                      <summary className="cursor-pointer font-medium">Análisis IA</summary>
                      <div className="mt-2 space-y-1">
                        {fb.analisis_ia.diagnostico && (
                          <p><span className="font-medium">Diagnóstico:</span> {fb.analisis_ia.diagnostico}</p>
                        )}
                        {fb.analisis_ia.campo_actual && (
                          <p><span className="font-medium">Campo:</span> {fb.analisis_ia.campo_actual} = {String(fb.analisis_ia.valor_actual)} (origen: {fb.analisis_ia.origen})</p>
                        )}
                        {accion && (
                          <p><span className="font-medium">Acción propuesta:</span> {accion.tipo} — {JSON.stringify({ ...accion, tipo: undefined })}</p>
                        )}
                      </div>
                    </details>
                  )}
                  {fb.override_aplicado && (
                    <p className="text-xs text-success flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Override aplicado: {fb.override_aplicado.campo} = {String(fb.override_aplicado.valor_nuevo)}
                    </p>
                  )}
                  {fb.estado === "analizada" && accion?.tipo === "override" && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => applyOverride(fb)} disabled={applying === fb.id}>
                        {applying === fb.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Aplicar override
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => descartar(fb)}>Descartar</Button>
                    </div>
                  )}
                  {fb.estado === "requiere_codigo" && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Requiere cambio de código — en cola para ingeniería
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
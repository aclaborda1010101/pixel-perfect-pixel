import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ArrowRight, Loader2, Check } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const STEPS = ["step1Upload", "step2Associate", "step3Process"] as const;

export default function AnalyzeCallWizard() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [direction, setDirection] = useState<"saliente" | "entrante">("saliente");
  const [q, setQ] = useState("");
  const [owners, setOwners] = useState<any[]>([]);
  const [pickedOwner, setPickedOwner] = useState<any>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    supabase.from("owners").select("id, nombre, email, telefono, rol").limit(100)
      .then(({ data }) => setOwners(data ?? []));
  }, []);

  const filtered = useMemo(
    () => owners.filter((o) => [o.nombre, o.email, o.telefono].some((f) => (f ?? "").toLowerCase().includes(q.toLowerCase()))),
    [owners, q]);

  const process = async () => {
    if (!pickedOwner || !transcript.trim()) return;
    setRunning(true);
    try {
      const { data: call, error: e1 } = await supabase.from("calls").insert({
        owner_id: pickedOwner.id, direccion: direction,
        fecha: new Date().toISOString(), transcripcion: transcript,
        duracion_seg: Math.max(60, Math.round(transcript.split(/\s+/).length / 2.5)),
      }).select().single();
      if (e1 || !call) throw e1 ?? new Error("insert failed");

      const { data, error } = await supabase.functions.invoke("agent_analyze_note", {
        body: { owner_id: pickedOwner.id, texto: transcript },
      });
      if (error) throw error;
      const a = (data as any).analysis;
      const resumen = [a?.hechos?.[0], a?.intenciones?.[0]].filter(Boolean).join(". ").slice(0, 500);
      await supabase.from("calls").update({ resumen }).eq("id", call.id);
      toast.success(t.wizard.analyzeDone);
      nav(`/llamadas/${call.id}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally { setRunning(false); }
  };

  const canNext = (step === 0 && transcript.trim().length > 20) || (step === 1 && pickedOwner);

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> {t.common.back}
      </Link>
      <PageHeader
        title={t.wizard.analyzeTitle}
        subtitle={`${t.common.step} ${step + 1} ${t.common.of} ${STEPS.length} · ${t.wizard[STEPS[step]]}`}
      />
      <Card>
        <CardContent className="space-y-4 p-6">
          {step === 0 && (
            <>
              <p className="text-xs text-muted-foreground">{t.wizard.audioNote}</p>
              <Textarea rows={10} placeholder={t.wizard.transcriptPlaceholder}
                value={transcript} onChange={(e) => setTranscript(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" variant={direction === "saliente" ? "default" : "outline"}
                  onClick={() => setDirection("saliente")}>{t.wizard.directionOut}</Button>
                <Button size="sm" variant={direction === "entrante" ? "default" : "outline"}
                  onClick={() => setDirection("entrante")}>{t.wizard.directionIn}</Button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <Input placeholder={t.wizard.pickOwner} value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="max-h-72 divide-y divide-border overflow-auto rounded border border-border">
                {filtered.map((o) => (
                  <li key={o.id}>
                    <button onClick={() => setPickedOwner(o)}
                      className={`w-full px-3 py-2 text-left text-sm hover:bg-accent/30 ${pickedOwner?.id === o.id ? "bg-accent/30" : ""}`}>
                      <div className="flex items-center justify-between">
                        <span>{o.nombre}</span>
                        {pickedOwner?.id === o.id && <Check className="h-3 w-3 text-primary" />}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{o.email ?? o.telefono ?? "—"}</span>
                        <Badge variant="outline" className="text-[10px]">{o.rol}</Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded border border-border p-4 text-sm">
                <div><b>Propietario:</b> {pickedOwner?.nombre}</div>
                <div><b>Dirección:</b> {direction === "saliente" ? t.wizard.directionOut : t.wizard.directionIn}</div>
                <div><b>Transcripción:</b> {transcript.length} caracteres</div>
              </div>
              <Button onClick={process} disabled={running} className="w-full">
                {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                {running ? t.wizard.processing : t.common.finish}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || running}>
              <ArrowLeft className="mr-2 h-3 w-3" /> {t.common.prev}
            </Button>
            {step < STEPS.length - 1 && (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
                {t.common.next} <ArrowRight className="ml-2 h-3 w-3" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

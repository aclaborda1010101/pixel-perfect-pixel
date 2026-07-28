import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Loader2, PhoneCall, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/I18nProvider";
import { toast } from "sonner";

type Brief = {
  contexto: string;
  objetivos: string[];
  preguntas_clave: string[];
  riesgos: string[];
  proxima_accion_sugerida: string;
  confianza: number;
};

export function PreCallBrief({ ownerId }: { ownerId: string }) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [vital, setVital] = useState<{
    estado_vital: string | null;
    estado_vital_fuente: string | null;
    estado_vital_fecha: string | null;
    edad_anios: number | null;
    nombre_display: string | null;
  } | null>(null);
  const [stats, setStats] = useState<{
    intentos_totales: number;
    veces_conectado: number;
    dias_desde_ultima_llamada: number | null;
    ultima_vez_conectado: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase.from("v_owner_call_stats" as any) as any)
        .select("intentos_totales, veces_conectado, dias_desde_ultima_llamada, ultima_vez_conectado")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (!cancelled) setStats((data as any) ?? null);
      const { data: o } = await (supabase.from("owners") as any)
        .select("estado_vital, estado_vital_fuente, estado_vital_fecha, edad_anios, nombre_display")
        .eq("id", ownerId)
        .maybeSingle();
      if (!cancelled) setVital((o as any) ?? null);
    })();
    return () => { cancelled = true; };
  }, [ownerId]);

  const generate = async () => {
    if (vital?.estado_vital === "fallecido") {
      toast.error("Propietario fallecido — localizar herederos, no llamar");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_pre_call_brief", {
        body: {
          owner_id: ownerId,
          locale,
          objetivo_override:
            vital?.estado_vital === "probable_fallecido"
              ? "Confirmar fallecimiento e identificar herederos legales antes de cualquier propuesta"
              : undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setBrief((data as any).brief);
    } catch (e: any) {
      toast.error(e?.message ?? "Error generando briefing");
    } finally {
      setLoading(false);
    }
  };

  const bloqueado = vital?.estado_vital === "fallecido";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          {t.agents.preCallTitle}
        </CardTitle>
        <Button size="sm" onClick={generate} disabled={loading || bloqueado} title={bloqueado ? "Propietario fallecido" : ""}>
          {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {t.agents.preCallGenerate}
        </Button>
      </CardHeader>
      {vital?.estado_vital === "fallecido" && (
        <CardContent className="pt-0">
          <div className="flex items-start gap-2 rounded-[4px] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Propietario fallecido</strong> — no llamar. Objetivo: localizar herederos legales (nota simple actualizada, comparecencia en herencia, empadronamiento).
              {vital.estado_vital_fuente && (
                <div className="text-xs opacity-80">Fuente: {vital.estado_vital_fuente}</div>
              )}
            </div>
          </div>
        </CardContent>
      )}
      {vital?.estado_vital === "probable_fallecido" && (
        <CardContent className="pt-0">
          <div className="flex items-start gap-2 rounded-[4px] border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm text-warning">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <strong>Probable fallecido</strong> — verificar antes de llamar. El brief se orienta a confirmar fallecimiento e identificar herederos.
            </div>
          </div>
        </CardContent>
      )}
      {stats && stats.intentos_totales > 0 && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 rounded-[4px] border bg-muted/40 px-3 py-2 text-sm">
            <PhoneCall className="h-3.5 w-3.5 text-primary" />
            <span>
              <strong>{stats.intentos_totales}</strong> intentos ·{" "}
              <strong>{stats.veces_conectado}</strong> cogidas ·{" "}
              {stats.ultima_vez_conectado
                ? <>última vez que habló hace <strong>{stats.dias_desde_ultima_llamada ?? "?"}</strong> días</>
                : <span className="text-muted-foreground">nunca ha cogido</span>}
            </span>
          </div>
        </CardContent>
      )}
      {brief && (
        <CardContent className="space-y-4 text-sm">
          <Section title={t.agents.preCallContext}>{brief.contexto}</Section>
          <ListSection title={t.agents.preCallObjectives} items={brief.objetivos} />
          <ListSection title={t.agents.preCallQuestions} items={brief.preguntas_clave} />
          <ListSection title={t.agents.preCallRisks} items={brief.riesgos} />
          <Section title={t.agents.preCallNextAction}>
            {brief.proxima_accion_sugerida}
          </Section>
          <div className="text-xs text-muted-foreground">
            {t.agents.preCallConfidence}: {(brief.confianza * 100).toFixed(0)}%
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <Section title={title}>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </Section>
  );
}
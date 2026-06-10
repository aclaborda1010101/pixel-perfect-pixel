import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2, ShieldCheck, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { upsertGroundTruth } from "@/lib/qaGroundTruth";

type BaseProps = {
  buildingId: string;
  dimension: string;
  detector: string;
  campo: string; // tabla.campo del dato verificado
  valorActual: unknown;
  label: string;
  onDone?: () => void;
};

async function registrarVerificacion(opts: BaseProps & { valorHumano: unknown; accion: "confirma" | "corrige"; autorId?: string | null; autorEmail?: string | null }) {
  const texto =
    opts.accion === "confirma"
      ? `Verificación humana: ${opts.dimension}=${JSON.stringify(opts.valorActual)} CORRECTO`
      : `Corrección humana: ${opts.dimension} era ${JSON.stringify(opts.valorActual)} → debe ser ${JSON.stringify(opts.valorHumano)}`;

  const { data: fb, error } = await supabase
    .from("building_feedback")
    .insert({
      building_id: opts.buildingId,
      canal: "verificacion_inline",
      texto,
      autor_id: opts.autorId ?? null,
      autor_email: opts.autorEmail ?? null,
      dimension: opts.dimension,
      estado: opts.accion === "confirma" ? "aplicada" : "nueva",
      metadatos: {
        detector: opts.detector,
        campo: opts.campo,
        valor_actual: opts.valorActual,
        valor_humano: opts.valorHumano,
        accion: opts.accion,
      },
    })
    .select("id")
    .single();
  if (error) throw error;

  // Fixture en qa_ground_truth (siempre que la dimensión tenga columna mapeada).
  await upsertGroundTruth({
    buildingId: opts.buildingId,
    dimension: opts.dimension,
    valorHumano: opts.accion === "confirma" ? opts.valorActual : opts.valorHumano,
    fuente: "verificacion_inline",
    verificadoPor: opts.autorEmail ?? null,
  });

  // Si corrige, lanzar diagnóstico IA del método.
  if (opts.accion === "corrige" && fb?.id) {
    try {
      await supabase.functions.invoke("agent_analyze_feedback", { body: { feedback_id: fb.id } });
    } catch (e) {
      console.error("analyze error", e);
    }
  }
  return fb?.id;
}

function Row({ label, valorActual, children, done }: { label: string; valorActual: unknown; children: React.ReactNode; done: "ok" | "fix" | null }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-border-faint last:border-0">
      <div className="text-xs">
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">actual: <span className="font-mono">{String(valorActual ?? "—")}</span></div>
      </div>
      <div className="flex items-center gap-1">
        {done === "ok" && <Badge variant="success" className="gap-1"><ShieldCheck className="h-3 w-3" /> verificado</Badge>}
        {done === "fix" && <Badge variant="info" className="gap-1"><Pencil className="h-3 w-3" /> corregido</Badge>}
        {!done && children}
      </div>
    </div>
  );
}

export function InlineVerifyNumber(props: BaseProps) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"ok" | "fix" | null>(null);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>(String(props.valorActual ?? ""));

  async function confirm(accion: "confirma" | "corrige", valorHumano?: unknown) {
    setBusy(true);
    try {
      await registrarVerificacion({ ...props, accion, valorHumano: valorHumano ?? props.valorActual, autorId: user?.id, autorEmail: user?.email });
      setDone(accion === "confirma" ? "ok" : "fix");
      toast.success(accion === "confirma" ? "Verificación registrada" : "Corrección registrada y diagnóstico en curso");
      props.onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row label={props.label} valorActual={props.valorActual} done={done}>
      {!editing ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm("confirma")}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Sí</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><X className="h-3 w-3" /> No, ajustar</Button>
        </>
      ) : (
        <>
          <Input value={val} onChange={(e) => setVal(e.target.value)} className="h-8 w-20" type="number" />
          <Button size="sm" disabled={busy} onClick={() => confirm("corrige", Number(val))}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Guardar"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        </>
      )}
    </Row>
  );
}

export function InlineVerifyBool(props: BaseProps & { trueLabel?: string; falseLabel?: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"ok" | "fix" | null>(null);

  async function go(accion: "confirma" | "corrige", valorHumano: boolean) {
    setBusy(true);
    try {
      await registrarVerificacion({ ...props, accion, valorHumano, autorId: user?.id, autorEmail: user?.email });
      setDone(accion === "confirma" ? "ok" : "fix");
      toast.success(accion === "confirma" ? "Verificación registrada" : "Corrección registrada y diagnóstico en curso");
      props.onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  const actualBool = Boolean(props.valorActual);
  return (
    <Row label={props.label} valorActual={actualBool ? (props.trueLabel ?? "Sí") : (props.falseLabel ?? "No")} done={done}>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => go("confirma", actualBool)}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Correcto</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => go("corrige", true)}>{props.trueLabel ?? "Sí"}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => go("corrige", false)}>{props.falseLabel ?? "No"}</Button>
    </Row>
  );
}

export function InlineVerifyEnum(props: BaseProps & { opciones: string[] }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"ok" | "fix" | null>(null);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState<string>("");

  async function go(accion: "confirma" | "corrige", valorHumano: string) {
    setBusy(true);
    try {
      await registrarVerificacion({ ...props, accion, valorHumano, autorId: user?.id, autorEmail: user?.email });
      setDone(accion === "confirma" ? "ok" : "fix");
      toast.success(accion === "confirma" ? "Verificación registrada" : "Corrección registrada y diagnóstico en curso");
      props.onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Row label={props.label} valorActual={props.valorActual} done={done}>
      {!editing ? (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => go("confirma", String(props.valorActual ?? ""))}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Correcto</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><X className="h-3 w-3" /> Otra</Button>
        </>
      ) : (
        <>
          <select className="h-8 rounded border bg-background px-2 text-xs" value={val} onChange={(e) => setVal(e.target.value)}>
            <option value="">elige…</option>
            {props.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value="__otra__">otra (escribir)</option>
          </select>
          {val === "__otra__" && (
            <Input className="h-8 w-32" placeholder="escribir…" onChange={(e) => setVal(e.target.value)} />
          )}
          <Button size="sm" disabled={busy || !val || val === "__otra__"} onClick={() => go("corrige", val)}>Guardar</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
        </>
      )}
    </Row>
  );
}
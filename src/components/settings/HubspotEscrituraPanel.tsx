import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type Auditoria = {
  activado?: boolean;
  campos_disponibles?: string[];
  campos_faltantes?: string[];
  pendientes?: number;
};

type Seco = {
  procesadas?: number;
  simuladas?: number;
  enviadas?: number;
  errores?: number;
  descartadas?: number;
  muestras?: { tarea: string; propiedades: Record<string, string>; deal: string | null }[];
};

export function HubspotEscrituraPanel() {
  const { toast } = useToast();
  const [activado, setActivado] = useState(false);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [auditoria, setAuditoria] = useState<Auditoria | null>(null);
  const [seco, setSeco] = useState<Seco | null>(null);
  const [cargando, setCargando] = useState<string | null>(null);

  async function cargar() {
    const [{ data: ajuste }, { data: counts }] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "hubspot_escritura_activada").maybeSingle(),
      (supabase.rpc as any)("hubspot_write_queue_counts"),
    ]);
    setActivado(ajuste?.value === true);
    setConteos((counts as Record<string, number>) ?? {});
  }

  useEffect(() => { cargar(); }, []);

  async function cambiarInterruptor(valor: boolean) {
    setCargando("switch");
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "hubspot_escritura_activada", value: valor as never }, { onConflict: "key" });
    setCargando(null);
    if (error) {
      toast({ title: "No se pudo cambiar", description: error.message, variant: "destructive" });
      return;
    }
    setActivado(valor);
    toast({
      title: valor ? "Escritura en HubSpot ACTIVADA" : "Escritura en HubSpot desactivada",
      description: valor ? "Las tareas pendientes se enviarán en la próxima pasada." : "Todo queda en simulación.",
    });
  }

  async function ejecutar(accion: "drain" | "audit") {
    setCargando(accion);
    try {
      const { data, error } = await supabase.functions.invoke("hubspot_write_worker", {
        body: { accion, limite: 50 },
      });
      if (error) throw error;
      if (accion === "audit") setAuditoria(data as Auditoria);
      else setSeco(data as Seco);
      await cargar();
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCargando(null);
    }
  }

  const pendientes = (conteos.pendiente ?? 0) + (conteos.error ?? 0);

  return (
    <Card className="md:col-span-2">
      <CardHeader className="space-y-2">
        <Eyebrow><Upload className="mr-1 inline h-3 w-3" /> HubSpot · Escritura</Eyebrow>
        <CardTitle>Envío de tareas y campos comerciales a HubSpot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-faint p-4">
          <div className="space-y-1">
            <div className="text-sm font-medium text-foreground">Interruptor maestro</div>
            <p className="text-xs text-muted-foreground">
              Apagado: todo se calcula y se guarda en cola, pero no se escribe nada en HubSpot.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={activado ? "gold" : "outline"}>{activado ? "Activado" : "Apagado"}</Badge>
            <Switch checked={activado} disabled={cargando === "switch"} onCheckedChange={cambiarInterruptor} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(["pendiente", "simulado", "enviado", "error", "descartado"] as const).map((k) => (
            <div key={k} className="rounded-md border border-border-faint p-3">
              <Eyebrow>{k}</Eyebrow>
              <div className="font-mono text-2xl text-foreground">{conteos[k] ?? 0}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={cargar}>
            <RefreshCw className="mr-1 h-3 w-3" /> Actualizar
          </Button>
          <Button size="sm" variant="outline" disabled={cargando === "audit"} onClick={() => ejecutar("audit")}>
            {cargando === "audit" ? "Comprobando…" : "Comprobar campos del portal"}
          </Button>
          <Button size="sm" variant="gold" disabled={cargando === "drain"} onClick={() => ejecutar("drain")}>
            {cargando === "drain" ? "Procesando…" : activado ? `Enviar ${pendientes} pendientes` : `Probar en seco (${pendientes})`}
          </Button>
        </div>

        {auditoria && (
          <div className="space-y-2 rounded-md border border-border-faint p-4 text-sm">
            <div className="flex items-center gap-2">
              {(auditoria.campos_faltantes?.length ?? 0) === 0
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <AlertTriangle className="h-4 w-4 text-warning" />}
              <span className="font-medium text-foreground">Campos comerciales en el contacto</span>
            </div>
            <div>
              <Eyebrow>Existen en HubSpot</Eyebrow>
              <div className="flex flex-wrap gap-1 pt-1">
                {(auditoria.campos_disponibles ?? []).map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
                {(auditoria.campos_disponibles?.length ?? 0) === 0 && <span className="text-muted-foreground">—</span>}
              </div>
            </div>
            <div>
              <Eyebrow>Faltan por crear en HubSpot</Eyebrow>
              <div className="flex flex-wrap gap-1 pt-1">
                {(auditoria.campos_faltantes ?? []).map((c) => <Badge key={c} variant="destructive">{c}</Badge>)}
                {(auditoria.campos_faltantes?.length ?? 0) === 0 && <span className="text-muted-foreground">Ninguno</span>}
              </div>
            </div>
          </div>
        )}

        {seco && (
          <div className="space-y-2 rounded-md border border-border-faint p-4 text-sm">
            <div className="font-medium text-foreground">
              Última pasada · {seco.procesadas ?? 0} filas · simuladas {seco.simuladas ?? 0} · enviadas {seco.enviadas ?? 0} · errores {seco.errores ?? 0}
            </div>
            {(seco.muestras ?? []).map((m, i) => (
              <pre key={i} className="overflow-x-auto rounded bg-surface-1 p-2 font-mono text-[11px] text-muted-foreground">
{JSON.stringify(m, null, 2)}
              </pre>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Search, Coins, TriangleAlert, MapPin, Phone, Building2, ListChecks } from "lucide-react";
import { Eyebrow } from "@/components/common/Eyebrow";
import { resolveBuildingTask } from "@/lib/taskStart";
import { parseGeneratedTaskKey } from "@/lib/whatsappTarjeta";

type Props = { task: any; onCompleted?: () => void | Promise<void> };

const PASOS_MANUALES = [
  "Entra en la web del proveedor con tu propio usuario.",
  "Busca el domicilio del propietario y consulta quién más consta viviendo en esa dirección.",
  "Consulta el padrón del edificio para ver los ocupantes de las demás viviendas.",
  "Anota sólo lo que sirva para localizar al propietario; los inquilinos no se dan de alta como contactos.",
];

/** Bloque de investigación previa (T-01): busca, propone y espera aprobación humana. */
export function TareaInvestigacionBlock({ task, onCompleted }: Props) {
  const qc = useQueryClient();
  const ownerId = parseGeneratedTaskKey(task?.task_key)?.subjectId ?? null;
  const [buscando, setBuscando] = useState(false);
  const [resolviendo, setResolviendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [detalleAviso, setDetalleAviso] = useState<string | null>(null);

  const clave = ["descubrimiento_tarea", task?.id, ownerId];

  const { data: plan } = useQuery({
    queryKey: ["investigacion_plan", ownerId, task?.building_id],
    enabled: !!(ownerId || task?.building_id),
    queryFn: async () => {
      const { data } = await supabase.functions.invoke("investigar_titular", {
        body: { accion: "plan", owner_id: ownerId, building_id: task?.building_id, task_id: task?.id },
      });
      return (data ?? null) as any;
    },
  });

  const { data: propuesta } = useQuery({
    queryKey: clave,
    enabled: !!(ownerId || task?.id),
    queryFn: async () => {
      let q = (supabase.from("descubrimientos" as any) as any)
        .select("*").eq("estado", "propuesta").order("created_at", { ascending: false }).limit(1);
      q = ownerId ? q.eq("owner_id", ownerId) : q.eq("task_id", task?.id);
      const { data } = await q;
      return ((data ?? [])[0] ?? null) as any;
    },
  });

  const abierta = task?.status === "pending" || task?.status === "in_progress";

  async function buscar(simular = false) {
    setBuscando(true); setAviso(null); setDetalleAviso(null);
    try {
      const { data, error } = await supabase.functions.invoke("investigar_titular", {
        body: {
          accion: "investigar", simular,
          owner_id: ownerId, building_id: task?.building_id, task_id: task?.id,
        },
      });
      if (error) { setAviso("No se ha podido lanzar la búsqueda."); return; }
      const r = data as any;
      if (r?.acceso_proveedor === false) {
        setAviso("El acceso al proveedor de datos no está activo todavía");
        setDetalleAviso(r?.respuesta_proveedor ?? r?.detalle ?? null);
        return;
      }
      if (!r?.ok) { setAviso(r?.mensaje ?? "No se ha podido completar la búsqueda."); return; }
      await qc.invalidateQueries({ queryKey: clave });
      toast.success(r?.cacheado ? "Búsqueda ya hecha antes: se reutiliza sin coste" : "Propuesta lista para revisar");
    } finally { setBuscando(false); }
  }

  async function aprobar() {
    setResolviendo(true);
    try {
      const { data, error } = await (supabase as any).rpc("aprobar_descubrimiento", { p_id: propuesta.id });
      if (error) { toast.error(error.message); return; }
      if (!(data as any)?.ok) { toast.error(`No se ha guardado: ${(data as any)?.motivo}`); return; }
      toast.success("Datos aprobados y guardados en la ficha");
      await qc.invalidateQueries({ queryKey: clave });
    } finally { setResolviendo(false); }
  }

  async function descartar() {
    setResolviendo(true);
    try {
      const { error } = await (supabase as any).rpc("descartar_descubrimiento", { p_id: propuesta.id });
      if (error) { toast.error(error.message); return; }
      toast.success("Propuesta descartada. No se ha guardado nada.");
      await qc.invalidateQueries({ queryKey: clave });
    } finally { setResolviendo(false); }
  }

  async function cerrarTarea() {
    setResolviendo(true);
    try {
      await resolveBuildingTask(task.id, "completed", "Investigación previa realizada");
      toast.success("Tarea cerrada");
      await onCompleted?.();
    } finally { setResolviendo(false); }
  }

  const coste = plan?.coste;
  const dom = (propuesta?.domicilios ?? []) as any[];
  const tels = (propuesta?.telefonos_encontrados ?? []) as string[];

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border-faint p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow><Search className="mr-1 inline h-3 w-3" /> Búsqueda automática</Eyebrow>
        {coste && (
          <Badge variant="outline" className="text-[10px]">
            <Coins className="mr-1 h-3 w-3" /> Coste estimado: {coste.minimo}–{coste.maximo} monedas
          </Badge>
        )}
      </div>

      {abierta && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="gold" disabled={buscando} onClick={() => buscar(false)}>
            {buscando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Search className="mr-1 h-3 w-3" />}
            Buscar automáticamente
          </Button>
          <Button size="sm" variant="outline" disabled={buscando} onClick={() => buscar(true)}>
            Probar con respuesta simulada
          </Button>
        </div>
      )}

      {aviso && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">
          <div className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="h-3.5 w-3.5 text-warning" /> {aviso}
          </div>
          {detalleAviso && (
            <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{detalleAviso}</div>
          )}
        </div>
      )}

      {propuesta && (
        <div className="space-y-2 rounded-md border border-border-faint bg-surface-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>Propuesta — pendiente de tu aprobación</Eyebrow>
            {propuesta.simulado && <Badge variant="outline" className="text-[10px]">Simulación</Badge>}
            {propuesta.ambiguo && <Badge variant="destructive" className="text-[10px]">Ambigua</Badge>}
            <Badge variant="outline" className="text-[10px]">{propuesta.coste_monedas} monedas</Badge>
          </div>

          {propuesta.ambiguo && (
            <p className="text-xs text-destructive">{propuesta.ambiguo_motivo}</p>
          )}

          <div className="space-y-1 text-xs text-foreground">
            <div className="flex items-start gap-1.5">
              <Phone className="mt-0.5 h-3 w-3 text-muted-foreground" />
              <span>{tels.length > 0 ? tels.join(" · ") : "Sin teléfonos encontrados"}</span>
            </div>
            {dom.map((d, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3 w-3 text-muted-foreground" />
                <span>
                  {d.direccion}{d.ciudad ? `, ${d.ciudad}` : ""}{d.codigo_postal ? ` (${d.codigo_postal})` : ""}
                  <span className="ml-1 text-muted-foreground">{d.actual ? "· domicilio actual" : "· domicilio anterior"}</span>
                </span>
              </div>
            ))}
            {propuesta.empresa_vinculada && (
              <div className="flex items-start gap-1.5">
                <Building2 className="mt-0.5 h-3 w-3 text-muted-foreground" />
                <span>{propuesta.empresa_vinculada.name ?? propuesta.empresa_vinculada.nombre ?? "Empresa vinculada"}</span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Nada de esto se guarda en la ficha del propietario hasta que lo apruebes.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="gold" disabled={resolviendo || propuesta.ambiguo} onClick={aprobar}>
              Aprobar y guardar
            </Button>
            <Button size="sm" variant="outline" disabled={resolviendo} onClick={descartar}>
              Descartar
            </Button>
            {abierta && (
              <Button size="sm" variant="ghost" disabled={resolviendo} onClick={cerrarTarea}>
                Cerrar tarea
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-md border border-border-faint p-2">
        <Eyebrow><ListChecks className="mr-1 inline h-3 w-3" /> Pasos manuales (no cubiertos por la búsqueda)</Eyebrow>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {PASOS_MANUALES.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </div>
    </div>
  );
}
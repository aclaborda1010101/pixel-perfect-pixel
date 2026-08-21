import { useEffect, useRef, useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { textoUltimaActualizacion, necesitaAviso, resumenCambios, type ResultadoSync } from "@/lib/hubspotSync";

export const AYUDA_SYNC =
  "Trae a Afflux los datos que hay en HubSpot para este edificio: contactos del negocio, porcentajes, teléfonos y llamadas. No escribe nada en HubSpot.";

interface Props {
  buildingId: string;
  lastSyncedAt: string | null | undefined;
  onDone?: () => void;
}

export function SyncHubspotBar({ buildingId, lastSyncedAt, onDone }: Props) {
  const [corriendo, setCorriendo] = useState(false);
  const [fecha, setFecha] = useState<string | null | undefined>(lastSyncedAt);
  const [mensaje, setMensaje] = useState<{ tono: "ok" | "aviso" | "error"; texto: string } | null>(null);

  const aviso = necesitaAviso(fecha);

  // Al abrir un edificio nunca sincronizado (o con datos viejos) traemos los
  // datos solos: el comercial no tiene que acordarse de pulsar el botón.
  const autoLanzado = useRef(false);
  useEffect(() => {
    if (autoLanzado.current) return;
    if (!buildingId) return;
    if (!necesitaAviso(lastSyncedAt)) return;
    autoLanzado.current = true;
    void actualizar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, lastSyncedAt]);

  async function actualizar(automatica = false) {
    setCorriendo(true);
    setMensaje(null);
    try {
      const { data, error } = await supabase.functions.invoke("sync_building_hubspot", {
        body: { building_id: buildingId },
      });
      if (error) {
        const detalle = (error as any)?.context?.text ? await (error as any).context.text() : error.message;
        let texto = detalle;
        try { texto = JSON.parse(detalle)?.error ?? detalle; } catch { /* texto plano */ }
        setMensaje({ tono: "error", texto: String(texto) });
        return;
      }
      const r = data as ResultadoSync & { ok: boolean; rate_limited?: boolean; mensaje?: string; last_synced_at?: string; error?: string };
      if (r?.rate_limited) {
        setMensaje({ tono: "aviso", texto: r.mensaje ?? "Espera un momento antes de volver a actualizar." });
        return;
      }
      if (!r?.ok) {
        setMensaje({ tono: "error", texto: r?.error ?? "No se han podido traer los datos de HubSpot." });
        return;
      }
      setFecha(r.last_synced_at ?? new Date().toISOString());
      setMensaje({
        tono: "ok",
        texto: automatica ? `Actualizado solo al abrir. ${resumenCambios(r)}` : resumenCambios(r),
      });
      onDone?.();
    } catch (e) {
      setMensaje({ tono: "error", texto: `No se han podido traer los datos de HubSpot: ${String((e as Error)?.message ?? e)}` });
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <div className="rounded-md border border-border-faint bg-surface-1 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn(aviso ? "text-amber-600" : "text-muted-foreground")}>
            {textoUltimaActualizacion(fecha)}
            {aviso && " · conviene actualizar"}
          </span>
          <Info className="h-3 w-3 text-muted-foreground" aria-hidden />
          <span className="sr-only">{AYUDA_SYNC}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => actualizar()} disabled={corriendo} title={AYUDA_SYNC}>
          <RefreshCw className={cn("h-3 w-3", corriendo && "animate-spin")} />
          {corriendo ? "Trayendo datos de HubSpot…" : "Actualizar desde HubSpot"}
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{AYUDA_SYNC}</div>
      {mensaje && (
        <div
          className={cn(
            "mt-2 rounded-md border px-3 py-2 text-xs",
            mensaje.tono === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
            mensaje.tono === "aviso" && "border-amber-500/40 bg-amber-500/10 text-amber-700",
            mensaje.tono === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {mensaje.texto}
        </div>
      )}
    </div>
  );
}

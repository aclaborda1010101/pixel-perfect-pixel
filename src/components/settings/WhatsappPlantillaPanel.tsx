import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";
import { PLANTILLA_T23_POR_DEFECTO, renderPlantilla } from "@/lib/whatsappTarjeta";

/** Ajustes del WhatsApp de la tarjeta de primera llamada (solo admin edita). */
export function WhatsappPlantillaPanel() {
  const qc = useQueryClient();
  const { isAdmin } = useCurrentRole();
  const [texto, setTexto] = useState("");
  const [modoPrueba, setModoPrueba] = useState(true);
  const [numero, setNumero] = useState("");
  const [guardando, setGuardando] = useState(false);

  const { data } = useQuery({
    queryKey: ["wa_ajustes_tarjeta"],
    queryFn: async () => {
      const { data } = await (supabase.from("app_settings" as any) as any)
        .select("key,value")
        .in("key", ["plantilla_whatsapp_t23", "wa_modo_prueba", "wa_numero_prueba"]);
      const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
      return {
        texto: String((map.get("plantilla_whatsapp_t23") as any)?.texto ?? PLANTILLA_T23_POR_DEFECTO),
        modoPrueba: ((map.get("wa_modo_prueba") as any)?.activo ?? true) === true,
        numero: String((map.get("wa_numero_prueba") as any)?.numero ?? ""),
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    setTexto(data.texto);
    setModoPrueba(data.modoPrueba);
    setNumero(data.numero);
  }, [data]);

  const guardar = async () => {
    setGuardando(true);
    try {
      const { error } = await (supabase.from("app_settings" as any) as any).upsert([
        { key: "plantilla_whatsapp_t23", value: { texto } },
        { key: "wa_modo_prueba", value: { activo: modoPrueba } },
        { key: "wa_numero_prueba", value: { numero } },
      ]);
      if (error) throw error;
      toast.success("Ajustes de WhatsApp guardados");
      await qc.invalidateQueries({ queryKey: ["wa_ajustes_tarjeta"] });
      await qc.invalidateQueries({ queryKey: ["wa_modo_prueba"] });
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudieron guardar los ajustes");
    } finally {
      setGuardando(false);
    }
  };

  const ejemplo = renderPlantilla(texto, {
    nombre: "María",
    comercial: "Jesús",
    direccion: "Calle Mayor 12",
  });

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <Eyebrow><MessageCircle className="mr-1 inline h-3 w-3" /> WhatsApp</Eyebrow>
        <CardTitle>Mensaje de primera llamada</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          disabled={!isAdmin}
          className="text-sm"
        />
        <div className="text-[11px] text-muted-foreground">
          Variables disponibles: {"{nombre}"}, {"{comercial}"}, {"{direccion}"}.
        </div>
        <div className="rounded-md border border-border-faint bg-surface-1/40 p-2 text-xs text-foreground">
          {ejemplo}
        </div>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium">Modo prueba (no se envía a propietarios)</span>
          <Switch checked={modoPrueba} onCheckedChange={setModoPrueba} disabled={!isAdmin} />
        </label>
        <div className="space-y-1">
          <Eyebrow>Número de prueba</Eyebrow>
          <Input
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="Vacío = solo se registra, sin envío real"
            disabled={!isAdmin}
          />
        </div>
        <Button variant="gold" size="sm" onClick={guardar} disabled={!isAdmin || guardando}>
          {guardando && <Loader2 className="h-3 w-3 animate-spin" />} Guardar
        </Button>
        {!isAdmin && (
          <div className="text-[11px] text-muted-foreground">Solo un administrador puede cambiar estos ajustes.</div>
        )}
      </CardContent>
    </Card>
  );
}

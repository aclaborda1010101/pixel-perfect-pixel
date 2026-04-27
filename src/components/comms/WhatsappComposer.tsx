import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Send, CalendarPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TEMPLATES = [
  { label: "Primer contacto", body: "Hola {{nombre}}, soy de AFFLUX. Trabajamos con propietarios de su zona. ¿Le interesaría una valoración orientativa de su inmueble sin compromiso?" },
  { label: "Seguimiento D+3", body: "Hola {{nombre}}, retomo nuestra conversación. ¿Pudo revisar la propuesta? Quedo atento." },
  { label: "Cierre suave", body: "Hola {{nombre}}, si prefiere no continuar le pido que me lo indique y dejo de contactarle. Gracias." },
];

const CADENCE = [
  { dia_offset: 0, tipo: "whatsapp" as const, plantilla: "Primer contacto" },
  { dia_offset: 3, tipo: "whatsapp" as const, plantilla: "Seguimiento D+3" },
  { dia_offset: 7, tipo: "llamada" as const, plantilla: "Llamada de seguimiento" },
  { dia_offset: 14, tipo: "whatsapp" as const, plantilla: "Cierre suave" },
];

export function WhatsappComposer({ ownerId, ownerName }: { ownerId: string; ownerName: string }) {
  const [body, setBody] = useState(TEMPLATES[0].body);
  const [busy, setBusy] = useState(false);

  const interp = (s: string) => s.replaceAll("{{nombre}}", ownerName);

  const queueMessage = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from("whatsapp_messages").insert({
        owner_id: ownerId,
        cuerpo: interp(body),
        status: "borrador",
      });
      if (error) throw error;
      toast.success("Mensaje guardado (mock — no se envía)");
    } catch (e: any) { toast.error(e?.message); } finally { setBusy(false); }
  };

  const startCadence = async () => {
    setBusy(true);
    try {
      const rows = CADENCE.map((c) => ({
        owner_id: ownerId,
        dia_offset: c.dia_offset,
        tipo: c.tipo,
        plantilla: c.plantilla,
        estado: "pendiente",
      }));
      const { error } = await supabase.from("cadence_steps").insert(rows);
      if (error) throw error;
      toast.success(`Cadencia creada (${rows.length} pasos)`);
    } catch (e: any) { toast.error(e?.message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" /> WhatsApp
          <Badge variant="outline" className="ml-2 text-amber-600 border-amber-500/40">Mock</Badge>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={startCadence} disabled={busy}>
          <CalendarPlus className="mr-2 h-3 w-3" /> Iniciar cadencia
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((tpl) => (
            <Button key={tpl.label} variant="outline" size="sm" onClick={() => setBody(tpl.body)}>
              {tpl.label}
            </Button>
          ))}
        </div>
        <Textarea rows={4} value={interp(body)} onChange={(e) => setBody(e.target.value)} />
        <div className="flex justify-end">
          <Button size="sm" onClick={queueMessage} disabled={busy}>
            <Send className="mr-2 h-3 w-3" /> Guardar mensaje
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
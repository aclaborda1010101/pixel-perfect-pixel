import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Quote, Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function VossCoachCard({ ownerId, buildingId, mode = "brief" as "brief" | "post", transcript, autoload }: { ownerId?: string; buildingId?: string; mode?: "brief" | "post"; transcript?: string; autoload?: boolean }) {
  const [voss, setVoss] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_voss_coach", {
        body: { mode, owner_id: ownerId, building_id: buildingId, call_transcript: transcript },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setVoss((data as any).voss);
    } catch (e: any) {
      toast.error(e?.message || "No se pudo generar el consejo Voss");
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <Eyebrow><Quote className="mr-1 inline h-3 w-3" /> Coach Voss</Eyebrow>
          <CardTitle>{mode === "brief" ? "Consejo pre-llamada" : "Análisis post-llamada"}</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {voss ? "Regenerar" : "Generar"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!voss && !busy && <p className="text-muted-foreground">Pulsa Generar para obtener una técnica concreta y una frase lista para decir.</p>}
        {voss && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="gold">{voss.tecnica_principal}</Badge>
            </div>
            <blockquote className="border-l-2 border-gold pl-3 italic text-foreground">"{voss.sugerencia}"</blockquote>
            {voss.por_que && <p className="text-muted-foreground"><span className="font-medium text-foreground">Por qué:</span> {voss.por_que}</p>}
            {voss.siguiente_paso && <p className="text-muted-foreground"><span className="font-medium text-foreground">Siguiente paso:</span> {voss.siguiente_paso}</p>}
            {Array.isArray(voss.fragmentos_usados) && voss.fragmentos_usados.length > 0 && (
              <details className="text-xs bg-muted/40 rounded p-2">
                <summary className="cursor-pointer">Fragmentos del corpus Voss</summary>
                <ul className="mt-2 space-y-1">
                  {voss.fragmentos_usados.map((f: any, i: number) => (
                    <li key={i}><Badge variant="outline" className="mr-1">{f.source}</Badge>{(f.snippet || "").slice(0, 240)}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
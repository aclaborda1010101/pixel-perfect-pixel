import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Workflow } from "lucide-react";
import { toast } from "sonner";

const TIPOLOGIAS = ["T1","T2","T3","T4","T5","T6","T7","T8","T9","T10"];

export function EnrichmentConfigPanel() {
  const [row, setRow] = useState<any>(null);
  const [reglas, setReglas] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("enrichment_config" as any).select("*").limit(1).maybeSingle();
    setRow(data);
    setReglas((data as any)?.reglas ?? {});
  };
  useEffect(() => { load(); }, []);

  const setKey = (k: string, v: string) => setReglas({ ...reglas, [k]: v });

  const save = async () => {
    if (!row) return;
    setBusy(true);
    const { error } = await supabase.from("enrichment_config" as any)
      .update({ reglas }).eq("id", row.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Reglas guardadas");
  };

  const keys = Array.from(new Set([
    "co_domicilio_sin_confirmar", "apoderado_con_control", "fallecido", "default",
    ...Object.keys(reglas),
  ]));

  return (
    <Card>
      <CardHeader>
        <Eyebrow><Workflow className="mr-1 inline h-3 w-3" /> Enriquecimiento</Eyebrow>
        <CardTitle>Reglas tipologías T1-T10</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {keys.map((k) => (
          <div key={k} className="flex items-center gap-2">
            <Input className="flex-1" value={k} readOnly />
            <Select value={reglas[k] ?? ""} onValueChange={(v) => setKey(k, v)}>
              <SelectTrigger className="w-28"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {TIPOLOGIAS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
        <Button size="sm" variant="gold" onClick={save} disabled={busy}>Guardar reglas</Button>
      </CardContent>
    </Card>
  );
}
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Row = {
  perfil_tipologia: string;
  tactica_tipo: string;
  tactica_texto: string;
  ejemplo_literal: string | null;
  n_usos: number;
  n_exito: number;
  tasa_exito: number;
  ultima_actualizacion: string;
};

export function PlaybookPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [recompute, setRecompute] = useState(false);

  async function load() {
    setBusy(true);
    const { data, error } = await supabase
      .from("call_playbook")
      .select("perfil_tipologia, tactica_tipo, tactica_texto, ejemplo_literal, n_usos, n_exito, tasa_exito, ultima_actualizacion")
      .order("tasa_exito", { ascending: false })
      .order("n_usos", { ascending: false })
      .limit(200);
    if (error) toast.error(error.message);
    setRows((data as Row[]) || []);
    setBusy(false);
  }

  useEffect(() => { load(); }, []);

  async function recalcular() {
    setRecompute(true);
    try {
      const { data, error } = await supabase.functions.invoke("learn_from_calls", { body: {} });
      if (error) throw error;
      toast.success(`Playbook recalculado: ${data?.tacticas_agregadas ?? 0} tácticas sobre ${data?.calls_consideradas ?? 0} llamadas.`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Error");
    } finally {
      setRecompute(false);
    }
  }

  const byPerfil = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.perfil_tipologia] ||= []).push(r);
    return acc;
  }, {});

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <Eyebrow><BookOpen className="mr-1 inline h-3 w-3" /> Playbook</Eyebrow>
          <CardTitle>Tácticas ganadoras por perfil · {rows.length} entradas</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={recalcular} disabled={recompute}>
          {recompute ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
          Recalcular
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {busy && <div className="text-sm text-muted-foreground">Cargando…</div>}
        {!busy && rows.length === 0 && <div className="text-sm text-muted-foreground">Sin datos todavía. Aún no hay llamadas con tácticas evaluadas.</div>}
        {Object.entries(byPerfil).map(([perfil, list]) => (
          <div key={perfil} className="space-y-1">
            <Eyebrow>{perfil}</Eyebrow>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left py-1 pr-2">Tipo</th>
                    <th className="text-left py-1 pr-2">Táctica</th>
                    <th className="text-right py-1 pr-2">Usos</th>
                    <th className="text-right py-1 pr-2">Éxitos</th>
                    <th className="text-right py-1 pr-2">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, 12).map((r) => (
                    <tr key={`${r.perfil_tipologia}-${r.tactica_tipo}-${r.tactica_texto}`} className="border-t border-border-faint">
                      <td className="py-1 pr-2"><Badge variant="outline" className="text-[10px]">{r.tactica_tipo}</Badge></td>
                      <td className="py-1 pr-2 font-mono">{r.tactica_texto}</td>
                      <td className="py-1 pr-2 text-right">{r.n_usos}</td>
                      <td className="py-1 pr-2 text-right">{r.n_exito}</td>
                      <td className="py-1 pr-2 text-right font-medium">{(Number(r.tasa_exito) * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
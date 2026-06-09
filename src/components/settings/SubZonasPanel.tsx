import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MapPin, Plus, Trash2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type SubZona = {
  id: string;
  calle_norm: string;
  numero_desde: number | null;
  numero_hasta: number | null;
  barrio: string | null;
  sub_zona: string | null;
  cluster_override: string | null;
  especificidad: number | null;
  notas: string | null;
};

const EMPTY: Omit<SubZona, "id"> = {
  calle_norm: "", numero_desde: null, numero_hasta: null,
  barrio: "", sub_zona: "", cluster_override: "", especificidad: 5, notas: "",
};

export function SubZonasPanel() {
  const [rows, setRows] = useState<SubZona[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Omit<SubZona, "id">>(EMPTY);

  async function load() {
    setLoading(true);
    const { data } = await (supabase.from("madrid_calles_subzona" as any) as any)
      .select("*").order("calle_norm").order("especificidad", { ascending: false });
    setRows((data ?? []) as SubZona[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!draft.calle_norm.trim()) {
      toast({ title: "Calle requerida", variant: "destructive" });
      return;
    }
    const { error } = await (supabase.from("madrid_calles_subzona" as any) as any).insert([{ ...draft, calle_norm: draft.calle_norm.trim().toLowerCase() }]);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setDraft(EMPTY); load();
    toast({ title: "Tramo añadido" });
  }
  async function remove(id: string) {
    const { error } = await (supabase.from("madrid_calles_subzona" as any) as any).delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    load();
  }
  async function recomputeAffected() {
    toast({ title: "Recomputando…", description: "Lanzando recompute global" });
    const { error } = await supabase.functions.invoke("recompute-all-scores", { body: {} });
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else toast({ title: "Recompute lanzado" });
  }

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <Eyebrow><MapPin className="mr-1 inline h-3 w-3" /> Scoring · Sub-zonas</Eyebrow>
          <CardTitle>Tramos de calle → cluster</CardTitle>
        </div>
        <Button size="sm" variant="outline" onClick={recomputeAffected}>
          <RefreshCw className="mr-1 h-3 w-3" /> Recomputar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          <Input placeholder="calle (norm)" value={draft.calle_norm} onChange={(e) => setDraft({ ...draft, calle_norm: e.target.value })} />
          <Input placeholder="nº desde" type="number" value={draft.numero_desde ?? ""} onChange={(e) => setDraft({ ...draft, numero_desde: e.target.value ? Number(e.target.value) : null })} />
          <Input placeholder="nº hasta" type="number" value={draft.numero_hasta ?? ""} onChange={(e) => setDraft({ ...draft, numero_hasta: e.target.value ? Number(e.target.value) : null })} />
          <Input placeholder="barrio" value={draft.barrio ?? ""} onChange={(e) => setDraft({ ...draft, barrio: e.target.value })} />
          <Input placeholder="sub-zona" value={draft.sub_zona ?? ""} onChange={(e) => setDraft({ ...draft, sub_zona: e.target.value })} />
          <Input placeholder="cluster_override" value={draft.cluster_override ?? ""} onChange={(e) => setDraft({ ...draft, cluster_override: e.target.value })} />
          <Button onClick={add}><Plus className="mr-1 h-3 w-3" /> Añadir</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border-faint">
                <th className="px-2 py-1 text-left">Calle</th>
                <th className="px-2 py-1 text-left">Nº</th>
                <th className="px-2 py-1 text-left">Barrio</th>
                <th className="px-2 py-1 text-left">Sub-zona</th>
                <th className="px-2 py-1 text-left">Cluster</th>
                <th className="px-2 py-1 text-left">Esp.</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="px-2 py-3 text-muted-foreground">Cargando…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-muted-foreground">Sin tramos.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-faint">
                  <td className="px-2 py-1 font-mono">{r.calle_norm}</td>
                  <td className="px-2 py-1">{r.numero_desde ?? "—"}–{r.numero_hasta ?? "—"}</td>
                  <td className="px-2 py-1">{r.barrio ?? "—"}</td>
                  <td className="px-2 py-1">{r.sub_zona ?? "—"}</td>
                  <td className="px-2 py-1">{r.cluster_override ? <Badge variant="gold">{r.cluster_override}</Badge> : "—"}</td>
                  <td className="px-2 py-1 font-mono">{r.especificidad ?? "—"}</td>
                  <td className="px-2 py-1 text-right">
                    <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3 w-3" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
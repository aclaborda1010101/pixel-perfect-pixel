import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

type Row = { id: string; scope_id: string | null; titulo: string; detalle: string | null; vencimiento: string | null; estado: string; origen: string | null; created_at: string; building?: { direccion: string } | null };

export default function NextActions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filtroUrg, setFiltroUrg] = useState<"todas"|"alta"|"media"|"baja">("todas");
  const [filtroOrigen, setFiltroOrigen] = useState<string>("todos");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("next_actions")
      .select("id, scope_id, titulo, detalle, vencimiento, estado, origen, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    const list = (data || []) as Row[];
    const ids = Array.from(new Set(list.map(r => r.scope_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: bs } = await supabase.from("buildings").select("id, direccion").in("id", ids);
      const map = new Map((bs||[]).map((b:any)=>[b.id,b.direccion]));
      list.forEach(r => { r.building = r.scope_id ? { direccion: map.get(r.scope_id) || "—" } : null; });
    }
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const recalcular = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect_stale_deals", { body: {} });
      if (error) throw error;
      toast.success(`Sugeridas ${data?.suggested ?? 0} acciones (alta=${data?.distribucion?.alta||0}, media=${data?.distribucion?.media||0}, baja=${data?.distribucion?.baja||0})`);
      await load();
    } catch (e:any) { toast.error(e.message || "Error"); }
    finally { setRunning(false); }
  };

  const recalcularHygiene = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect_pipeline_hygiene", { body: {} });
      if (error) throw error;
      toast.success(`Hygiene: ${data?.total_problems ?? 0} problemas en ${data?.with_problems ?? 0} edificios`);
      await load();
    } catch (e:any) { toast.error(e.message || "Error"); }
    finally { setRunning(false); }
  };

  const origenes = useMemo(() => Array.from(new Set(rows.map(r=>r.origen).filter(Boolean))) as string[], [rows]);
  const filtered = rows.filter(r => {
    if (filtroOrigen !== "todos" && r.origen !== filtroOrigen) return false;
    if (filtroUrg === "todas") return true;
    return r.titulo.toUpperCase().includes(`[${filtroUrg.toUpperCase()}]`);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Próximas acciones</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} de {rows.length} acciones</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={recalcular} disabled={running} variant="outline">{running ? "…" : "Recalcular Stale"}</Button>
          <Button onClick={recalcularHygiene} disabled={running}>{running ? "…" : "Recalcular Hygiene"}</Button>
        </div>
      </div>

      <div className="flex gap-2 text-sm">
        {(["todas","alta","media","baja"] as const).map(u => (
          <button key={u} onClick={()=>setFiltroUrg(u)} className={`px-3 py-1 rounded-full border ${filtroUrg===u?"bg-primary text-primary-foreground":"bg-surface-1"}`}>{u}</button>
        ))}
        <div className="ml-2 flex gap-2">
          {(["todos","stale_deal_reviver","pipeline_hygiene"] as const).map(o => (
            <button key={o} onClick={()=>setFiltroOrigen(o)} className={`px-3 py-1 rounded-full border ${filtroOrigen===o?"bg-primary text-primary-foreground":"bg-surface-1"}`}>
              {o==="todos"?"Todos":o==="stale_deal_reviver"?"Stale Deal Reviver":"Pipeline Hygiene"}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Edificio</TableHead>
            <TableHead>Acción</TableHead>
            <TableHead>Mensaje sugerido</TableHead>
            <TableHead>Vencimiento</TableHead>
            <TableHead>Origen</TableHead>
            <TableHead>Estado</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow><TableCell colSpan={6}>Cargando…</TableCell></TableRow>
          ) : filtered.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.building?.direccion || "—"}</TableCell>
              <TableCell className="font-medium">{r.titulo}</TableCell>
              <TableCell className="max-w-md text-sm text-muted-foreground">{r.detalle}</TableCell>
              <TableCell>{r.vencimiento || "—"}</TableCell>
              <TableCell><code className="text-xs">{r.origen || "—"}</code></TableCell>
              <TableCell>{r.estado}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

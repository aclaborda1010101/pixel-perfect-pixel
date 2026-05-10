import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Row = { id: string; scope_id: string | null; titulo: string; detalle: string | null; vencimiento: string | null; estado: string; origen: string | null; created_at: string; building?: { direccion: string } | null };

const ORIGEN_LABEL: Record<string, string> = {
  stale_deal_reviver: "Oportunidades dormidas",
  pipeline_hygiene: "Higiene del pipeline",
};

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
      toast.success(`Higiene: ${data?.total_problems ?? 0} problemas en ${data?.with_problems ?? 0} edificios`);
      await load();
    } catch (e:any) { toast.error(e.message || "Error"); }
    finally { setRunning(false); }
  };

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
          <Button onClick={recalcular} disabled={running} variant="outline">{running ? "…" : "Recalcular dormidas"}</Button>
          <Button onClick={recalcularHygiene} disabled={running}>{running ? "…" : "Recalcular higiene"}</Button>
        </div>
      </div>

      <div className="rounded-lg border bg-surface-1/40 p-4 text-sm text-muted-foreground space-y-1">
        <p><strong className="text-foreground">Oportunidades dormidas:</strong> edificios sin actividad en HubSpot (llamadas, notas, tareas o cambios) durante más de 14 días y que no están en una etapa final.</p>
        <p><strong className="text-foreground">Higiene del pipeline:</strong> deals con datos incompletos — sin tarea siguiente, sin fecha de cierre, sin propietario, en negociación &gt;30 días, sin importe o sin contacto asociado.</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Origen</label>
          <Select value={filtroOrigen} onValueChange={setFiltroOrigen}>
            <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="stale_deal_reviver">Oportunidades dormidas</SelectItem>
              <SelectItem value="pipeline_hygiene">Higiene del pipeline</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Urgencia</label>
          <Select value={filtroUrg} onValueChange={(v)=>setFiltroUrg(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="media">Media</SelectItem>
              <SelectItem value="baja">Baja</SelectItem>
            </SelectContent>
          </Select>
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
          ) : filtered.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">No hay acciones con esos filtros</TableCell></TableRow>
          ) : filtered.map(r => (
            <TableRow key={r.id}>
              <TableCell>{r.building?.direccion || "—"}</TableCell>
              <TableCell className="font-medium">{r.titulo}</TableCell>
              <TableCell className="max-w-md text-sm text-muted-foreground">{r.detalle}</TableCell>
              <TableCell>{r.vencimiento || "—"}</TableCell>
              <TableCell>
                {r.origen ? (
                  <Badge variant={r.origen === "stale_deal_reviver" ? "secondary" : "default"}>
                    {ORIGEN_LABEL[r.origen] || r.origen}
                  </Badge>
                ) : "—"}
              </TableCell>
              <TableCell>{r.estado}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

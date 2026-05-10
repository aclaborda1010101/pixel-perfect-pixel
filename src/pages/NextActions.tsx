import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

type Row = { id: string; scope_id: string | null; titulo: string; detalle: string | null; vencimiento: string | null; estado: string; origen: string | null; created_at: string; building?: { direccion: string } | null };

const ORIGEN_LABEL: Record<string, string> = {
  stale_deal_reviver: "Oportunidades dormidas",
  pipeline_hygiene: "Higiene del pipeline",
};

const PAGE_SIZE = 50;

export default function NextActions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filtroUrg, setFiltroUrg] = useState<"todas"|"alta"|"media"|"baja">("todas");
  const [filtroOrigen, setFiltroOrigen] = useState<string>("todos");
  const [filtroEstado, setFiltroEstado] = useState<string>("todos");
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => { const t = setTimeout(() => setQDeb(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [filtroUrg, filtroOrigen, filtroEstado, qDeb]);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("next_actions")
      .select("id, scope_id, titulo, detalle, vencimiento, estado, origen, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    if (filtroOrigen !== "todos") query = query.eq("origen", filtroOrigen);
    if (filtroEstado !== "todos") query = query.eq("estado", filtroEstado);
    if (filtroUrg !== "todas") query = query.ilike("titulo", `%[${filtroUrg.toUpperCase()}]%`);
    if (qDeb) {
      const s = qDeb.replace(/[%,]/g, "");
      query = query.or(`titulo.ilike.%${s}%,detalle.ilike.%${s}%`);
    }

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await query.range(from, to);
    const list = (data || []) as Row[];
    setTotal(count ?? 0);
    const ids = Array.from(new Set(list.map(r => r.scope_id).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: bs } = await supabase.from("buildings").select("id, direccion").in("id", ids);
      const map = new Map((bs||[]).map((b:any)=>[b.id,b.direccion]));
      list.forEach(r => { r.building = r.scope_id ? { direccion: map.get(r.scope_id) || "—" } : null; });
    }
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filtroUrg, filtroOrigen, filtroEstado, qDeb, page]);

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Próximas acciones</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} acciones</p>
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
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Título o detalle…" className="h-9 w-[260px] pl-8 text-sm" />
          </div>
        </div>
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
        <div className="flex flex-col gap-1">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Estado</label>
          <Select value={filtroEstado} onValueChange={setFiltroEstado}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="hecha">Hecha</SelectItem>
              <SelectItem value="descartada">Descartada</SelectItem>
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
          ) : rows.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">No hay acciones con esos filtros</TableCell></TableRow>
          ) : rows.map(r => (
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

      <div className="flex items-center justify-between border-t pt-3">
        <div className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {loading ? "Cargando…" : `Mostrando ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} de ${total.toLocaleString()}`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={()=>setPage(p=>Math.max(0,p-1))}>
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </Button>
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">Página {page+1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page+1 >= totalPages || loading} onClick={()=>setPage(p=>p+1)}>
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

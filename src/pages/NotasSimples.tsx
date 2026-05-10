import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText, Loader2, AlertTriangle, CheckCircle2, Clock, Plus,
  Search, Filter, X, Download, RefreshCcw, Building2, Calendar as CalendarIcon, ChevronLeft, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UploadNotaSimpleDialog } from "@/components/notas/UploadNotaSimpleDialog";

type Row = {
  id: string;
  created_at: string;
  processed_at: string | null;
  status: string;
  riesgo: string | null;
  file_url: string | null;
  building_id: string | null;
  owner_id: string | null;
  structured_json: any | null;
  error_message: string | null;
  building_direccion: string | null;
  building_ciudad: string | null;
  owner_nombre: string | null;
  total_count: number;
};

type Kpis = { total: number; listas: number; riesgo_alto: number; sin_edificio: number; importe_cargas: number };

const PAGE_SIZE = 50;

function StatusChip({ status }: { status: string }) {
  if (status === "procesando") return <Badge variant="info"><Loader2 className="h-3 w-3 animate-spin mr-1" />procesando</Badge>;
  if (status === "listo") return <Badge variant="success"><CheckCircle2 className="h-3 w-3 mr-1" />listo</Badge>;
  if (status === "error") return <Badge variant="danger"><AlertTriangle className="h-3 w-3 mr-1" />error</Badge>;
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />pendiente</Badge>;
}
function RiesgoBadge({ r }: { r: string | null }) {
  if (!r) return <span className="text-muted-foreground text-xs">—</span>;
  const v = r === "alto" ? "danger" : r === "medio" ? "warning" : "success";
  return <Badge variant={v as any}>{r}</Badge>;
}
function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" }); }
  catch { return d; }
}
function fileNameFromUrl(u: string | null) {
  if (!u) return null;
  const tail = u.split("/").pop() ?? u;
  return tail.length > 37 ? tail.slice(37) : tail;
}

/* ───── Autocomplete genérico ───── */
function EntityAutocomplete({
  value, onChange, table, labelField, secondaryField, placeholder,
}: {
  value: { id: string; label: string } | null;
  onChange: (v: { id: string; label: string } | null) => void;
  table: "buildings" | "owners";
  labelField: string;
  secondaryField?: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    let cancel = false;
    const t = setTimeout(async () => {
      const term = q.trim();
      let query = supabase.from(table).select(`id, ${labelField}${secondaryField ? `, ${secondaryField}` : ""}`).limit(20);
      if (term) query = query.ilike(labelField, `%${term}%`);
      const { data } = await query;
      if (!cancel) setItems(data ?? []);
    }, 200);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, table, labelField, secondaryField]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between font-normal min-w-[180px] max-w-[240px]">
          <span className="truncate">{value?.label ?? placeholder}</span>
          {value
            ? <X className="h-3.5 w-3.5 opacity-60" onClick={(e) => { e.stopPropagation(); onChange(null); }} />
            : <Search className="h-3.5 w-3.5 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              {items.map((it: any) => (
                <CommandItem key={it.id} value={it.id} onSelect={() => {
                  onChange({ id: it.id, label: it[labelField] ?? "—" });
                  setOpen(false);
                }}>
                  <div className="flex flex-col">
                    <span className="text-sm">{it[labelField] ?? "—"}</span>
                    {secondaryField && it[secondaryField] && (
                      <span className="text-xs text-muted-foreground">{it[secondaryField]}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/* ───── Página ───── */
export default function NotasSimples() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  // Filtros
  const [search, setSearch] = useState("");
  const [searchDeb, setSearchDeb] = useState("");
  useEffect(() => { const t = setTimeout(() => setSearchDeb(search.trim()), 250); return () => clearTimeout(t); }, [search]);
  const [estado, setEstado] = useState<string>("all");
  const [riesgo, setRiesgo] = useState<string>("all");
  const [tipoCarga, setTipoCarga] = useState<string>("all");
  const [divisible, setDivisible] = useState<string>("all");
  const [building, setBuilding] = useState<{ id: string; label: string } | null>(null);
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();

  // Data
  const [rows, setRows] = useState<Row[]>([]);
  const [kpis, setKpis] = useState<Kpis>({ total: 0, listas: 0, riesgo_alto: 0, sin_edificio: 0, importe_cargas: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const rpcArgs = useMemo(() => ({
    p_status: estado === "all" ? null : estado,
    p_riesgo: riesgo === "all" ? null : riesgo,
    p_from: from ? from.toISOString() : null,
    p_to: to ? new Date(to.getTime() + 24 * 3600 * 1000 - 1).toISOString() : null,
    p_building_id: building?.id ?? null,
    p_owner_id: owner?.id ?? null,
    p_tipo_carga: tipoCarga === "all" ? null : tipoCarga,
    p_divisible: divisible === "all" ? null : divisible,
    p_search: searchDeb || null,
  }), [estado, riesgo, from, to, building, owner, tipoCarga, divisible, searchDeb]);

  // Reset page on filter change
  useEffect(() => { setPage(0); setSelected(new Set()); }, [rpcArgs]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rowsData, error: rerr }, { data: kpiData, error: kerr }] = await Promise.all([
      supabase.rpc("notas_simples_search", { ...rpcArgs, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE }),
      supabase.rpc("notas_simples_kpis", rpcArgs),
    ]);
    if (rerr) toast.error(rerr.message);
    if (kerr) toast.error(kerr.message);
    setRows((rowsData ?? []) as Row[]);
    if (kpiData && (kpiData as any[])[0]) {
      const k = (kpiData as any[])[0];
      setKpis({
        total: Number(k.total ?? 0),
        listas: Number(k.listas ?? 0),
        riesgo_alto: Number(k.riesgo_alto ?? 0),
        sin_edificio: Number(k.sin_edificio ?? 0),
        importe_cargas: Number(k.importe_cargas ?? 0),
      });
    }
    setLoading(false);
  }, [rpcArgs, page]);

  useEffect(() => { load(); }, [load]);

  // Realtime: refresh current page
  useEffect(() => {
    const ch = supabase.channel(`notas_rt_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notas_simples" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const total = kpis.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pctListo = total > 0 ? Math.round((kpis.listas / total) * 100) : 0;
  const pctRiesgoAlto = total > 0 ? Math.round((kpis.riesgo_alto / total) * 100) : 0;

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(rows.map(r => r.id)));
    else setSelected(new Set());
  };
  const toggleOne = (id: string, checked: boolean) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (checked) n.add(id); else n.delete(id);
      return n;
    });
  };

  const resetFilters = () => {
    setSearch(""); setEstado("all"); setRiesgo("all"); setTipoCarga("all");
    setDivisible("all"); setBuilding(null); setOwner(null); setFrom(undefined); setTo(undefined);
  };

  /* ───── Bulk actions ───── */
  const bulkReanalyze = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    const ids = Array.from(selected);
    const { error } = await supabase.from("notas_simples")
      .update({ status: "pendiente", error_message: null })
      .in("id", ids);
    if (error) { toast.error(error.message); setBusy(false); return; }
    // disparar análisis en paralelo (no bloqueamos UI)
    let ok = 0, fail = 0;
    await Promise.all(ids.map(async (id) => {
      const { error } = await supabase.functions.invoke("analyze_nota_simple", { body: { nota_simple_id: id } });
      if (error) fail++; else ok++;
    }));
    toast.success(`Reanalizadas: ${ok}${fail ? ` · ${fail} con error` : ""}`);
    setSelected(new Set()); setBusy(false); load();
  };

  const [bulkBuilding, setBulkBuilding] = useState<{ id: string; label: string } | null>(null);
  const bulkAssignBuilding = async () => {
    if (selected.size === 0 || !bulkBuilding) return;
    setBusy(true);
    const { error } = await supabase.from("notas_simples")
      .update({ building_id: bulkBuilding.id })
      .in("id", Array.from(selected));
    if (error) toast.error(error.message);
    else toast.success(`Asignado edificio a ${selected.size} notas`);
    setSelected(new Set()); setBulkBuilding(null); setBusy(false); load();
  };

  const exportCsv = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("notas_simples_search", {
      ...rpcArgs, p_limit: 5000, p_offset: 0,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const list = (data ?? []) as Row[];
    const headers = ["id","created_at","status","riesgo","building","ciudad","owner","ref_catastral","titular","cargas_tipo","importe_cargas","divisible"];
    const escape = (v: any) => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(",")];
    for (const r of list) {
      const sj = r.structured_json ?? {};
      const cargas = Array.isArray(sj.cargas) ? sj.cargas : [];
      const tipos = Array.from(new Set(cargas.map((c: any) => c?.tipo).filter(Boolean))).join("|");
      const importe = cargas.reduce((a: number, c: any) => {
        const n = Number(c?.importe);
        return Number.isFinite(n) ? a + n : a;
      }, 0);
      const titular = sj?.titulares?.[0]?.nombre ?? "";
      lines.push([
        r.id, r.created_at, r.status, r.riesgo ?? "",
        r.building_direccion ?? "", r.building_ciudad ?? "",
        r.owner_nombre ?? "",
        sj?.finca?.ref_catastral ?? "",
        titular, tipos, importe || "",
        sj?.divisible === true ? "true" : sj?.divisible === false ? "false" : "",
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `notas-simples-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportadas ${list.length} filas`);
  };

  const anyFilter = !!(searchDeb || estado !== "all" || riesgo !== "all" || tipoCarga !== "all" || divisible !== "all" || building || owner || from || to);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Captación"
        title="Notas Simples"
        subtitle="Sube notas del Registro y extrae titulares, cargas y nivel de riesgo."
        actions={
          <Button onClick={() => setOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> Solicitar nota
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card><div className="p-4"><Eyebrow>Total</Eyebrow><div className="mt-1"><MetricValue size="lg">{total}</MetricValue></div></div></Card>
        <Card><div className="p-4"><Eyebrow>% listo</Eyebrow><div className="mt-1"><MetricValue size="lg" unit="%">{pctListo}</MetricValue></div></div></Card>
        <Card><div className="p-4"><Eyebrow>% riesgo alto</Eyebrow><div className="mt-1"><MetricValue size="lg" unit="%">{pctRiesgoAlto}</MetricValue></div></div></Card>
        <Card><div className="p-4"><Eyebrow>Σ cargas</Eyebrow><div className="mt-1"><MetricValue size="lg" unit="€">{Math.round(kpis.importe_cargas).toLocaleString("es-ES")}</MetricValue></div></div></Card>
        <Card><div className="p-4"><Eyebrow>Sin edificio</Eyebrow><div className="mt-1"><MetricValue size="lg">{kpis.sin_edificio}</MetricValue></div></div></Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar dirección, ref. catastral o titular…"
                className="h-8 pl-8 text-sm" />
            </div>

            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger className="h-8 w-[140px] text-sm"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Estado: todos</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="procesando">Procesando</SelectItem>
                <SelectItem value="listo">Listo</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={riesgo} onValueChange={setRiesgo}>
              <SelectTrigger className="h-8 w-[140px] text-sm"><SelectValue placeholder="Riesgo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Riesgo: todos</SelectItem>
                <SelectItem value="alto">Alto</SelectItem>
                <SelectItem value="medio">Medio</SelectItem>
                <SelectItem value="bajo">Bajo</SelectItem>
              </SelectContent>
            </Select>

            <Select value={tipoCarga} onValueChange={setTipoCarga}>
              <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue placeholder="Tipo carga" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Carga: cualquiera</SelectItem>
                <SelectItem value="hipoteca">Hipoteca</SelectItem>
                <SelectItem value="embargo">Embargo</SelectItem>
                <SelectItem value="anotacion">Anotación</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>

            <Select value={divisible} onValueChange={setDivisible}>
              <SelectTrigger className="h-8 w-[140px] text-sm"><SelectValue placeholder="Divisible" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Divisible: —</SelectItem>
                <SelectItem value="true">Sí divisible</SelectItem>
                <SelectItem value="false">No divisible</SelectItem>
              </SelectContent>
            </Select>

            <EntityAutocomplete
              value={building} onChange={setBuilding}
              table="buildings" labelField="direccion" secondaryField="ciudad"
              placeholder="Edificio…"
            />
            <EntityAutocomplete
              value={owner} onChange={setOwner}
              table="owners" labelField="nombre"
              placeholder="Propietario…"
            />

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-8 font-normal", !from && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {from ? format(from, "dd/MM/yy") : "Desde"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={from} onSelect={setFrom} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-8 font-normal", !to && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {to ? format(to, "dd/MM/yy") : "Hasta"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={to} onSelect={setTo} className={cn("p-3 pointer-events-auto")} />
              </PopoverContent>
            </Popover>

            {anyFilter && (
              <Button variant="ghost" size="sm" className="h-8" onClick={resetFilters}>
                <X className="h-3.5 w-3.5" /> Limpiar
              </Button>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={busy || total === 0}>
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-faint bg-muted/40 px-3 py-2">
              <Badge variant="info">{selected.size} seleccionada{selected.size > 1 ? "s" : ""}</Badge>
              <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={bulkReanalyze}>
                <RefreshCcw className="h-3.5 w-3.5" /> Reanalizar
              </Button>
              <div className="flex items-center gap-2">
                <EntityAutocomplete
                  value={bulkBuilding} onChange={setBulkBuilding}
                  table="buildings" labelField="direccion" secondaryField="ciudad"
                  placeholder="Asignar edificio…"
                />
                <Button variant="outline" size="sm" className="h-8" disabled={busy || !bulkBuilding} onClick={bulkAssignBuilding}>
                  <Building2 className="h-3.5 w-3.5" /> Aplicar
                </Button>
              </div>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())}>
                <X className="h-3.5 w-3.5" /> Limpiar selección
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText}
          title={anyFilter ? "Sin resultados con esos filtros" : "Sin notas todavía"}
          description={anyFilter ? "Ajusta o limpia los filtros para ver más." : "Sube tu primera nota simple para empezar."} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={rows.length > 0 && rows.every(r => selected.has(r.id))}
                        onCheckedChange={(c) => toggleAll(!!c)}
                      />
                    </TableHead>
                    <TableHead>Edificio</TableHead>
                    <TableHead>Propietario</TableHead>
                    <TableHead className="hidden md:table-cell">Ref. catastral</TableHead>
                    <TableHead className="hidden lg:table-cell">Cargas</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Riesgo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((n) => {
                    const sj = n.structured_json ?? {};
                    const titular = sj?.titulares?.[0]?.nombre;
                    const ref = sj?.finca?.ref_catastral;
                    const cargas = Array.isArray(sj.cargas) ? sj.cargas : [];
                    const tiposC = Array.from(new Set(cargas.map((c: any) => c?.tipo).filter(Boolean))) as string[];
                    return (
                      <TableRow key={n.id} className="cursor-pointer"
                        onClick={() => navigate(`/notas-simples/${n.id}`)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.has(n.id)}
                            onCheckedChange={(c) => toggleOne(n.id, !!c)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {n.building_direccion ? (
                            <>
                              <div className="truncate max-w-[260px]">{n.building_direccion}</div>
                              {n.building_ciudad && <div className="text-xs text-muted-foreground">{n.building_ciudad}</div>}
                            </>
                          ) : titular || ref || n.file_url ? (
                            <div>
                              <div className="font-medium truncate max-w-[260px]">{titular ?? fileNameFromUrl(n.file_url) ?? "— sin asignar —"}</div>
                              <div className="text-xs text-muted-foreground">sin edificio asignado</div>
                            </div>
                          ) : <span className="text-muted-foreground">— sin asignar —</span>}
                        </TableCell>
                        <TableCell>{n.owner_nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground font-mono">{ref ?? "—"}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {tiposC.length === 0
                            ? <span className="text-muted-foreground text-xs">—</span>
                            : <div className="flex flex-wrap gap-1">{tiposC.slice(0, 3).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(n.created_at)}</TableCell>
                        <TableCell><StatusChip status={n.status} /></TableCell>
                        <TableCell><RiesgoBadge r={n.riesgo} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Paginación */}
            <div className="flex items-center justify-between border-t border-border-faint px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                {total === 0 ? "0" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)}`} de {total.toLocaleString("es-ES")}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                </Button>
                <span className="text-xs text-muted-foreground">{page + 1} / {pageCount}</span>
                <Button variant="outline" size="sm" className="h-8" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>
                  Siguiente <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <UploadNotaSimpleDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

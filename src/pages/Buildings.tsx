import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { NewBuildingDialog } from "@/components/forms/NewEntityDialogs";

const PAGE_SIZE = 50;
const ESTADOS = ["identificado", "contactado", "negociacion", "cerrado", "descartado"];

export default function Buildings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState({ total: 0, dh: 0, propietarios: 0 });

  // debounce buscador
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // reset página al cambiar filtros/busqueda
  useEffect(() => { setPage(0); }, [debouncedQ, filter]);

  // métricas globales (independientes de paginación)
  const loadMetrics = async () => {
    const [tot, dh, props] = await Promise.all([
      supabase.from("buildings").select("id", { count: "exact", head: true }),
      supabase.from("buildings").select("id", { count: "exact", head: true }).eq("division_horizontal", true),
      supabase.from("building_owners").select("building_id", { count: "exact", head: true }),
    ]);
    setMetrics({
      total: tot.count ?? 0,
      dh: dh.count ?? 0,
      propietarios: props.count ?? 0,
    });
  };

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("buildings")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (debouncedQ.trim()) {
      const s = debouncedQ.trim().replace(/[%,]/g, "");
      query = query.or(
        `direccion.ilike.%${s}%,ciudad.ilike.%${s}%,codigo_postal.ilike.%${s}%`
      );
    }
    if (filter !== "all") query = query.eq("estado", filter as any);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await query.range(from, to);

    setRows(data ?? []);
    setTotal(count ?? 0);

    if (data && data.length) {
      const { data: bo } = await supabase
        .from("building_owners")
        .select("building_id")
        .in("building_id", data.map((b: any) => b.id));
      const c: Record<string, number> = {};
      (bo ?? []).forEach((r: any) => { c[r.building_id] = (c[r.building_id] ?? 0) + 1; });
      setCounts(c);
    } else {
      setCounts({});
    }
    setLoading(false);
  };

  useEffect(() => { loadMetrics(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debouncedQ, filter, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Edificios"
        title={t.nav.buildings}
        subtitle={`${metrics.total.toLocaleString()} edificios en gestión`}
        actions={<NewBuildingDialog onCreated={() => { loadMetrics(); load(); }} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total edificios</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.total.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Propietarios vinculados</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.propietarios.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>División horizontal</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.dh.toLocaleString()}</MetricValue></div></div></Card>
      </div>

      {metrics.total === 0 ? (
        <EmptyState icon={Building2} title="Aún no hay edificios" description="Crea un edificio para asociarle propietarios (con su sub-rol y cuota) y luego activos." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por dirección, ciudad, CP…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>
              {ESTADOS.map((e) => (
                <Chip key={e} active={filter === e} onClick={() => setFilter(e)}>{e}</Chip>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {rows.map((b) => (
              <li key={b.id} className="px-4 py-5">
                <Link to={`/edificios/${b.id}`} className="block space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Eyebrow>Dirección</Eyebrow>
                      <div className="text-base font-medium text-foreground break-words">{b.direccion}</div>
                      <div className="font-mono text-[12px] uppercase tracking-eyebrow text-muted-foreground">{b.ciudad ?? "—"} · {b.codigo_postal ?? "—"}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline">{b.estado}</Badge>
                      {b.division_horizontal && <Badge variant="gold">DH</Badge>}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <Eyebrow>Propietarios</Eyebrow>
                    <div className="font-mono tabular-nums text-foreground">{counts[b.id] ?? 0}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="min-w-[280px]">Dirección</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>CP</TableHead>
                  <TableHead className="text-right">Propietarios</TableHead>
                  <TableHead>DH</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Sin coincidencias.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((b) => (
                  <TableRow key={b.id} className="bg-card">
                    <TableCell>
                      <Link to={`/edificios/${b.id}`} className="font-medium text-foreground hover:text-gold">
                        {b.direccion}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{b.ciudad ?? "—"}</TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">{b.codigo_postal ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{counts[b.id] ?? 0}</TableCell>
                    <TableCell>
                      {b.division_horizontal ? <Badge variant="gold">DH</Badge> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{b.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-faint px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              {loading ? "Cargando…" : `Mostrando ${showingFrom.toLocaleString()}–${showingTo.toLocaleString()} de ${total.toLocaleString()}`}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft className="h-3.5 w-3.5" /> Anterior
              </Button>
              <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Página {page + 1} / {totalPages}
              </div>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                Siguiente <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow transition-colors " +
        (active
          ? "border-gold/60 bg-gold-soft/40 text-gold"
          : "border-border bg-transparent text-muted-foreground hover:border-gold/40 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

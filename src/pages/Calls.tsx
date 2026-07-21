import { useEffect, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PhoneCall, Search, ArrowDownLeft, ArrowUpRight, FileText } from "lucide-react";

function fmtDur(s: number | null | undefined) {
  if (!s) return "0:00";
  // Defensa: >4h en una llamada es imposible → asume ms mal escritos como segundos.
  let secs = s;
  if (secs > 14400) {
    console.warn("[Calls.fmtDur] duración anómala, interpretada como ms:", s);
    secs = Math.round(secs / 1000);
  }
  const m = Math.floor(secs / 60);
  const sec = secs % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Calls() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [dirFilter, setDirFilter] = useState<string>("all");
  const [analyzableOnly, setAnalyzableOnly] = useState<boolean>(true);
  const [stats, setStats] = useState({ total: 0, analizables: 0, sinTranscripcion: 0, avgDur: 0 });
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [analysisByHs, setAnalysisByHs] = useState<Record<string, number | null>>({});
  const PAGE_SIZE = 50;

  // Global stats over v_calls_feed (todas las llamadas de HubSpot atribuibles a un owner)
  useEffect(() => {
    (async () => {
      const base = () => (supabase.from("v_calls_feed" as any) as any)
        .select("*", { count: "exact", head: true })
        .not("owner_id", "is", null);
      const [t, a, s] = await Promise.all([
        base(),
        base().eq("conectada", true).eq("tiene_transcripcion", true),
        base().eq("conectada", true).eq("tiene_transcripcion", false),
      ]);
      let avg = 0;
      try {
        const { data: rpc } = await supabase.rpc("calls_stats" as any);
        const r = Array.isArray(rpc) ? rpc[0] : rpc;
        if (r) avg = Math.round(Number(r.avg_duracion) || 0);
      } catch { /* noop */ }
      setStats({
        total: t.count ?? 0,
        analizables: a.count ?? 0,
        sinTranscripcion: s.count ?? 0,
        avgDur: avg,
      });
    })();
  }, []);

  // Reset pagination when server-side filters change
  useEffect(() => { setPage(0); }, [dirFilter, analyzableOnly]);

  // Paginated list from v_calls_feed → refleja TODAS las llamadas sincronizadas de HubSpot
  const fetchPage = useCallback(async () => {
    setLoadingList(true);
    let query: any = (supabase.from("v_calls_feed" as any) as any)
      .select("hs_id, fecha, duracion_seg, direccion, resultado, resumen, owner_id, owner_nombre, building_id, session_id, puntuacion, session_estado, tiene_grabacion, tiene_transcripcion, conectada", { count: "exact" })
      .not("owner_id", "is", null)
      .order("fecha", { ascending: false });
    if (analyzableOnly) {
      query = query.eq("conectada", true).eq("tiene_transcripcion", true);
    }
    if (dirFilter !== "all") {
      const dir = dirFilter === "entrante" ? "inbound" : "outbound";
      query = query.eq("direccion", dir);
    }
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await query.range(from, to);
    const list = (data ?? []).map((r: any) => ({
      id: r.hs_id,
      fecha: r.fecha,
      duracion_seg: r.duracion_seg,
      direccion: r.direccion === "inbound" ? "entrante" : "saliente",
      resumen: r.resumen,
      owner_id: r.owner_id,
      owners: { nombre: r.owner_nombre },
      metadatos: { hs_id: r.hs_id },
      puntuacion: r.puntuacion,
    }));
    setRows(list);
    setPageCount(count ? Math.ceil(count / PAGE_SIZE) : 0);
    const m: Record<string, number | null> = {};
    for (const r of (data ?? []) as any[]) if (r.puntuacion != null) m[String(r.hs_id)] = r.puntuacion;
    setAnalysisByHs(m);
    setLoadingList(false);
  }, [page, dirFilter, analyzableOnly]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  // Free-text search applies on the current page only
  const filtered = useMemo(
    () => rows.filter((r) =>
      !q ||
      [r.owners?.nombre, r.resumen].some((f) => (f ?? "").toLowerCase().includes(q.toLowerCase())),
    ),
    [rows, q],
  );

  const analizables = stats.analizables;
  const avgDur = stats.avgDur;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pipeline · Llamadas"
        title={t.callsPage.title}
        subtitle={t.callsPage.subtitle}
        actions={
          <Button asChild size="sm" variant="gold">
            <Link to="/analizar-llamada">{t.callsPage.uploadCta}</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Analizables</Eyebrow><div className="mt-2"><MetricValue size="lg">{analizables.toLocaleString()}</MetricValue></div><div className="mt-1 text-xs text-muted-foreground">de {stats.total.toLocaleString()} totales</div></div></Card>
        <Card><div className="p-5"><Eyebrow>Sin transcripción</Eyebrow><div className="mt-2"><MetricValue size="lg">{stats.sinTranscripcion.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Duración media</Eyebrow><div className="mt-2"><MetricValue size="lg">{fmtDur(avgDur)}</MetricValue></div></div></Card>
      </div>

      {stats.total === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="Aún no has registrado llamadas"
          description="Sube una grabación o pega la transcripción para que la IA la procese."
          ctaLabel="Analizar una llamada"
          ctaTo="/analizar-llamada"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar propietario, resumen…" className="h-8 pl-8 text-sm" />
            </div>
            <div className="flex items-center gap-1.5">
              {([
                { v: true, label: "Solo analizables" },
                { v: false, label: "Todas" },
              ] as const).map((opt) => (
                <button key={String(opt.v)} type="button" onClick={() => setAnalyzableOnly(opt.v)}
                  className={"rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow transition-colors " +
                    (analyzableOnly === opt.v ? "border-gold/60 bg-gold-soft/40 text-gold" : "border-border bg-transparent text-muted-foreground hover:border-gold/40 hover:text-foreground")}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              {(["all", "saliente", "entrante"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDirFilter(d)}
                  className={"rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow transition-colors " +
                    (dirFilter === d ? "border-gold/60 bg-gold-soft/40 text-gold" : "border-border bg-transparent text-muted-foreground hover:border-gold/40 hover:text-foreground")}>
                  {d === "all" ? "Todas" : d}
                </button>
              ))}
            </div>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {filtered.map((c) => {
              const hsId = c?.metadatos?.hs_id ?? c?.metadatos?.hubspot_id ?? null;
              const to = hsId ? `/comercial/llamada/${hsId}` : `/llamadas/${c.id}`;
              const punt = hsId ? analysisByHs[String(hsId)] : null;
              return (
              <li key={c.id} className="px-4 py-5">
                <Link to={to} className="block space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Eyebrow>Propietario</Eyebrow>
                      {c.owner_id ? (
                        <Link
                          to={`/propietarios/${c.owner_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate text-base font-medium text-foreground hover:text-gold"
                        >
                          {c.owners?.nombre ?? "—"}
                        </Link>
                      ) : (
                        <div className="truncate text-base font-medium text-foreground">{c.owners?.nombre ?? "—"}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {punt != null && (
                        <Badge className="rounded-[4px] border-transparent bg-gold-soft/40 text-gold font-mono">{punt}/100</Badge>
                      )}
                      <Badge variant="outline">{c.direccion === "entrante" ? "Entrante" : "Saliente"}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Eyebrow>Fecha</Eyebrow>
                      <div className="font-mono tabular-nums text-foreground">{new Date(c.fecha).toLocaleDateString()}</div>
                    </div>
                    <div className="text-right">
                      <Eyebrow>Duración</Eyebrow>
                      <div className="font-mono tabular-nums text-foreground">{fmtDur(c.duracion_seg)}</div>
                    </div>
                  </div>
                  <div>
                    <Eyebrow>Estado</Eyebrow>
                    <div className="mt-1">{c.resumen ? <span className="text-sm text-muted-foreground line-clamp-2">{c.resumen}</span> : <StatusBadge status="no_summary" />}</div>
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-[240px]">{t.callsPage.colOwner}</TableHead>
                <TableHead>{t.callsPage.colDate}</TableHead>
                <TableHead className="text-right">{t.callsPage.colDuration}</TableHead>
                <TableHead>{t.callsPage.colDirection}</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead className="min-w-[200px]">{t.callsPage.colSummary}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => {
                const hsId = c?.metadatos?.hs_id ?? c?.metadatos?.hubspot_id ?? null;
                const to = hsId ? `/comercial/llamada/${hsId}` : `/llamadas/${c.id}`;
                const punt = hsId ? analysisByHs[String(hsId)] : null;
                const isInbound = c.direccion === "entrante" || String(c.direccion).toUpperCase() === "INBOUND";
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer bg-card hover:bg-muted/40"
                    onClick={() => navigate(to)}
                  >
                    <TableCell>
                      {c.owner_id ? (
                        <Link
                          to={`/propietarios/${c.owner_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:text-gold"
                        >
                          {c.owners?.nombre ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{c.owners?.nombre ?? "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">{new Date(c.fecha).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{fmtDur(c.duracion_seg)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {isInbound ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
                        {isInbound ? "Entrante" : "Saliente"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {punt != null ? (
                        <Badge className="rounded-[4px] border-transparent bg-gold-soft/40 text-gold font-mono">{punt}/100</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {c.resumen ?? <StatusBadge status="no_summary" />}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {hsId && (
                        <Link to={to} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                          <FileText className="h-3 w-3" /> Ver análisis
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-border-faint px-4 py-3">
              <div className="text-xs text-muted-foreground">
                Página <span className="font-mono tabular-nums">{page + 1}</span> de <span className="font-mono tabular-nums">{pageCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loadingList}
                  className="rounded-[3px] border border-border bg-transparent px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground">
                  ← Anterior
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1 || loadingList}
                  className="rounded-[3px] border border-border bg-transparent px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground">
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

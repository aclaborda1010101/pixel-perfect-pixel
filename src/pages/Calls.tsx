import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
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
import { PhoneCall, Search } from "lucide-react";

function fmtDur(s: number | null | undefined) {
  if (!s) return "0:00";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function Calls() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [dirFilter, setDirFilter] = useState<string>("all");

  useEffect(() => {
    supabase.from("calls")
      .select("id, fecha, duracion_seg, direccion, resumen, owner_id, owners(nombre)")
      .order("fecha", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => dirFilter === "all" || r.direccion === dirFilter)
        .filter((r) =>
          [r.owners?.nombre, r.resumen].some((f) =>
            (f ?? "").toLowerCase().includes(q.toLowerCase()),
          ),
        ),
    [rows, q, dirFilter],
  );

  const analyzed = rows.filter((r) => r.resumen).length;
  const avgDur = rows.length ? Math.round(rows.reduce((a, r) => a + (r.duracion_seg || 0), 0) / rows.length) : 0;

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

      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total llamadas</Eyebrow><div className="mt-2"><MetricValue size="lg">{rows.length}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Analizadas</Eyebrow><div className="mt-2"><MetricValue size="lg">{analyzed}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Duración media</Eyebrow><div className="mt-2"><MetricValue size="lg">{fmtDur(avgDur)}</MetricValue></div></div></Card>
      </div>

      {rows.length === 0 ? (
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
              {(["all", "saliente", "entrante"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDirFilter(d)}
                  className={"rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow transition-colors " +
                    (dirFilter === d ? "border-gold/60 bg-gold-soft/40 text-gold" : "border-border bg-transparent text-muted-foreground hover:border-gold/40 hover:text-foreground")}>
                  {d === "all" ? "Todas" : d}
                </button>
              ))}
            </div>
          </div>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-[240px]">{t.callsPage.colOwner}</TableHead>
                <TableHead>{t.callsPage.colDate}</TableHead>
                <TableHead className="text-right">{t.callsPage.colDuration}</TableHead>
                <TableHead>{t.callsPage.colDirection}</TableHead>
                <TableHead className="min-w-[200px]">{t.callsPage.colSummary}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="bg-card">
                  <TableCell>
                    <Link to={`/llamadas/${c.id}`} className="font-medium text-foreground hover:text-gold">
                      {c.owners?.nombre ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono tabular-nums text-muted-foreground">{new Date(c.fecha).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmtDur(c.duracion_seg)}</TableCell>
                  <TableCell><Badge variant="outline">{c.direccion}</Badge></TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {c.resumen ?? <StatusBadge status="no_summary" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

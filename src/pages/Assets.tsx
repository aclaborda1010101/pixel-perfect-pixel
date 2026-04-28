import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { ValuatorButton } from "@/components/agents/ValuatorButton";
import { Boxes, Search } from "lucide-react";
import { NewAssetDialog } from "@/components/forms/NewEntityDialogs";

export default function Assets() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState<string>("all");

  const load = useCallback(() => {
    supabase.from("assets").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const tipos = useMemo(() => Array.from(new Set(rows.map((r) => r.tipo).filter(Boolean))), [rows]);
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => tipo === "all" || r.tipo === tipo)
        .filter((r) =>
          [r.ubicacion, r.ciudad, r.tipo].some((f) =>
            (f ?? "").toString().toLowerCase().includes(q.toLowerCase()),
          ),
        ),
    [rows, q, tipo],
  );

  const totalVal = rows.reduce((a, r) => a + (Number(r.valoracion_estimada) || 0), 0);
  const totalSup = rows.reduce((a, r) => a + (Number(r.superficie_m2) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Activos"
        title={t.nav.assets}
        subtitle={`${rows.length} activos catalogados`}
        actions={<NewAssetDialog onCreated={load} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total activos</Eyebrow><div className="mt-2"><MetricValue size="lg">{rows.length}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Superficie total</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="m²">{totalSup.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Valoración agregada</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="€">{totalVal.toLocaleString()}</MetricValue></div></div></Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Sin activos en el catálogo"
          description="Añade activos para asociarlos a propietarios y usarlos en briefings de llamadas."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por ubicación, tipo…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Chip active={tipo === "all"} onClick={() => setTipo("all")}>Todos</Chip>
              {tipos.map((tp) => (
                <Chip key={tp} active={tipo === tp} onClick={() => setTipo(tp)}>{tp}</Chip>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {filtered.map((a) => (
              <li key={a.id} className="px-4 py-5">
                <Link to={`/activos/${a.id}`} className="block space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Eyebrow>Tipo</Eyebrow>
                      <div className="text-base font-medium text-foreground"><Badge variant="outline">{a.tipo}</Badge></div>
                    </div>
                    <Badge variant="gold" className="shrink-0">{a.estado}</Badge>
                  </div>
                  <div>
                    <Eyebrow>Ubicación</Eyebrow>
                    <div className="text-base text-foreground break-words">{a.ubicacion}{a.ciudad ? `, ${a.ciudad}` : ""}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Eyebrow>Superficie</Eyebrow>
                      <div className="font-mono tabular-nums text-foreground">{a.superficie_m2 ?? "—"}{a.superficie_m2 ? " m²" : ""}</div>
                    </div>
                    <div className="text-right">
                      <Eyebrow>Valoración</Eyebrow>
                      <div className="font-mono tabular-nums text-foreground">{a.valoracion_estimada ? `${Number(a.valoracion_estimada).toLocaleString()} €` : "—"}</div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-[120px]">Tipo</TableHead>
                <TableHead className="min-w-[280px]">Ubicación</TableHead>
                <TableHead className="text-right">Superficie</TableHead>
                <TableHead className="text-right">Valoración</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => (
                <TableRow key={a.id} className="bg-card">
                  <TableCell><Badge variant="outline">{a.tipo}</Badge></TableCell>
                  <TableCell>
                    <Link to={`/activos/${a.id}`} className="font-medium text-foreground hover:text-gold">
                      {a.ubicacion}{a.ciudad ? `, ${a.ciudad}` : ""}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {a.superficie_m2 ?? "—"}{a.superficie_m2 ? <span className="ml-1 text-muted-foreground">m²</span> : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {a.valoracion_estimada ? (
                      <>{Number(a.valoracion_estimada).toLocaleString()}<span className="ml-1 text-muted-foreground">€</span></>
                    ) : "—"}
                  </TableCell>
                  <TableCell><Badge variant="gold">{a.estado}</Badge></TableCell>
                  <TableCell className="text-right">
                    <ValuatorButton assetId={a.id} onDone={load} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

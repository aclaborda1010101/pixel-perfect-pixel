import { useEffect, useState, useMemo } from "react";
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
import { Building2, Search } from "lucide-react";
import { NewBuildingDialog } from "@/components/forms/NewEntityDialogs";

export default function Buildings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const load = async () => {
    const { data } = await supabase.from("buildings").select("*").order("updated_at", { ascending: false });
    setRows(data ?? []);
    if (data && data.length) {
      const { data: bo } = await supabase.from("building_owners").select("building_id").in("building_id", data.map((b) => b.id));
      const c: Record<string, number> = {};
      (bo ?? []).forEach((r: any) => { c[r.building_id] = (c[r.building_id] ?? 0) + 1; });
      setCounts(c);
    }
  };
  useEffect(() => { load(); }, []);

  const estados = useMemo(() => Array.from(new Set(rows.map((r) => r.estado).filter(Boolean))), [rows]);
  const filtered = useMemo(
    () =>
      rows
        .filter((r) => filter === "all" || r.estado === filter)
        .filter((r) =>
          [r.direccion, r.ciudad, r.codigo_postal].some((f) =>
            (f ?? "").toString().toLowerCase().includes(q.toLowerCase()),
          ),
        ),
    [rows, q, filter],
  );

  const totalProps = Object.values(counts).reduce((a, b) => a + b, 0);
  const dhCount = rows.filter((r) => r.division_horizontal).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Edificios"
        title={t.nav.buildings}
        subtitle={`${rows.length} edificios en gestión`}
        actions={<NewBuildingDialog onCreated={load} />}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <div className="p-5">
            <Eyebrow>Total edificios</Eyebrow>
            <div className="mt-2"><MetricValue size="lg">{rows.length}</MetricValue></div>
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <Eyebrow>Propietarios vinculados</Eyebrow>
            <div className="mt-2"><MetricValue size="lg">{totalProps}</MetricValue></div>
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <Eyebrow>División horizontal</Eyebrow>
            <div className="mt-2"><MetricValue size="lg">{dhCount}</MetricValue></div>
          </div>
        </Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="Aún no hay edificios" description="Crea un edificio para asociarle propietarios (con su sub-rol y cuota) y luego activos." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por dirección, ciudad…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>
              {estados.map((e) => (
                <Chip key={e} active={filter === e} onClick={() => setFilter(e)}>{e}</Chip>
              ))}
            </div>
          </div>

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
              {filtered.map((b) => (
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

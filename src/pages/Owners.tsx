import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Users, Search, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { NewOwnerDialog } from "@/components/forms/NewEntityDialogs";

type Owner = {
  id: string;
  nombre: string;
  email: string | null;
  telefono: string | null;
  rol: string;
  subrole: string;
  consentimiento: boolean;
  updated_at: string;
};

const PAGE_SIZE = 50;
const ROLES = ["desconocido", "propietario", "heredero", "representante", "inquilino"];

export default function Owners() {
  const { t } = useI18n();
  const [data, setData] = useState<Owner[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rolFilter, setRolFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState({ total: 0, consentidos: 0, sinRol: 0 });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(0); }, [debouncedQ, rolFilter]);

  const loadMetrics = async () => {
    const [tot, cons, sin] = await Promise.all([
      supabase.from("owners").select("id", { count: "exact", head: true }),
      supabase.from("owners").select("id", { count: "exact", head: true }).eq("consentimiento", true),
      supabase.from("owners").select("id", { count: "exact", head: true }).eq("rol", "desconocido" as any),
    ]);
    setMetrics({
      total: tot.count ?? 0,
      consentidos: cons.count ?? 0,
      sinRol: sin.count ?? 0,
    });
  };

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("owners")
      .select("id,nombre,email,telefono,rol,subrole,consentimiento,updated_at", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (debouncedQ.trim()) {
      const s = debouncedQ.trim().replace(/[%,]/g, "");
      query = query.or(`nombre.ilike.%${s}%,email.ilike.%${s}%,telefono.ilike.%${s}%`);
    }
    if (rolFilter !== "all") query = query.eq("rol", rolFilter as any);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, count } = await query.range(from, to);

    setData((data as Owner[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { loadMetrics(); }, []);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [debouncedQ, rolFilter, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM · Propietarios"
        title={t.owners.title}
        subtitle={`${metrics.total.toLocaleString()} propietarios en cartera`}
        actions={<NewOwnerDialog onCreated={() => { loadMetrics(); load(); }} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.total.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Con consentimiento</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.consentidos.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Sin rol catalogado</Eyebrow><div className="mt-2"><MetricValue size="lg">{metrics.sinRol.toLocaleString()}</MetricValue></div></div></Card>
      </div>

      {metrics.total === 0 ? (
        <EmptyState
          icon={Users}
          title="Aún no hay propietarios"
          description="Los propietarios se crean automáticamente al analizar llamadas o asociarlos a un activo."
          ctaLabel="Analizar una llamada"
          ctaTo="/analizar-llamada"
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t.common.search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={rolFilter === "all"} onClick={() => setRolFilter("all")}>Todos</Chip>
              {ROLES.map((r) => (
                <Chip key={r} active={rolFilter === r} onClick={() => setRolFilter(r)}>{r}</Chip>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {data.map((o) => (
              <li key={o.id} className="px-4 py-5">
                <Link to={`/propietarios/${o.id}`} className="block space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Eyebrow>Nombre</Eyebrow>
                      <div className="truncate text-base font-medium text-foreground">{o.nombre}</div>
                      <div className="font-mono text-[12px] uppercase tracking-eyebrow text-muted-foreground truncate">{o.email ?? o.telefono ?? "—"}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{o.rol}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Eyebrow>Consentimiento</Eyebrow>
                      <div className="text-foreground">{o.consentimiento ? <span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" />Sí</span> : "—"}</div>
                    </div>
                    <div className="text-right">
                      <Eyebrow>Último contacto</Eyebrow>
                      <div className="font-mono tabular-nums text-foreground">{new Date(o.updated_at).toLocaleDateString()}</div>
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
                  <TableHead className="min-w-[280px]">{t.owners.title}</TableHead>
                  <TableHead>{t.owners.role}</TableHead>
                  <TableHead>{t.owners.consent}</TableHead>
                  <TableHead className="text-right">{t.owners.lastContact}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Sin coincidencias.
                    </TableCell>
                  </TableRow>
                )}
                {data.map((o) => (
                  <TableRow key={o.id} className="bg-card">
                    <TableCell>
                      <Link to={`/propietarios/${o.id}`} className="font-medium text-foreground hover:text-gold">
                        {o.nombre}
                      </Link>
                      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {o.email ?? o.telefono ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{o.rol}</Badge></TableCell>
                    <TableCell>
                      {o.consentimiento ? (
                        <span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" /><span className="text-xs">Sí</span></span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {new Date(o.updated_at).toLocaleDateString()}
                    </TableCell>
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

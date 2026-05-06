import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Users, Search, Check } from "lucide-react";
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

export default function Owners() {
  const { t } = useI18n();
  const [data, setData] = useState<Owner[]>([]);
  const [q, setQ] = useState("");
  const [rolFilter, setRolFilter] = useState<string>("all");

  const load = async () => {
    const { data } = await supabase
      .from("owners")
      .select("id,nombre,email,telefono,rol,subrole,consentimiento,updated_at")
      .order("updated_at", { ascending: false })
      .range(0, 9999);
    setData((data as Owner[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const roles = useMemo(() => Array.from(new Set(data.map((o) => o.rol).filter(Boolean))), [data]);
  const filtered = useMemo(
    () =>
      data
        .filter((o) => rolFilter === "all" || o.rol === rolFilter)
        .filter((o) =>
          [o.nombre, o.email, o.telefono].some((f) =>
            (f ?? "").toLowerCase().includes(q.toLowerCase()),
          ),
        ),
    [data, q, rolFilter],
  );

  const consentidos = data.filter((o) => o.consentimiento).length;
  const sinRol = data.filter((o) => o.rol === "desconocido").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM · Propietarios"
        title={t.owners.title}
        subtitle={`${data.length} propietarios en cartera`}
        actions={<NewOwnerDialog onCreated={load} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total</Eyebrow><div className="mt-2"><MetricValue size="lg">{data.length}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Con consentimiento</Eyebrow><div className="mt-2"><MetricValue size="lg">{consentidos}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Sin rol catalogado</Eyebrow><div className="mt-2"><MetricValue size="lg">{sinRol}</MetricValue></div></div></Card>
      </div>

      {data.length === 0 ? (
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
              {roles.map((r) => (
                <Chip key={r} active={rolFilter === r} onClick={() => setRolFilter(r)}>{r}</Chip>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {filtered.map((o) => (
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
              {filtered.length === 0 && data.length > 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Sin coincidencias para “{q}”.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((o) => (
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

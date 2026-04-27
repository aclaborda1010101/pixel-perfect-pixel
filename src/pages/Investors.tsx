import { useEffect, useState, useMemo } from "react";
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
import { BetaBanner } from "@/components/common/BetaBanner";
import { NewInvestorDialog } from "@/components/forms/NewEntityDialogs";
import { Briefcase, Search } from "lucide-react";

export default function Investors() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const load = () => supabase.from("investors").select("*").order("updated_at", { ascending: false })
    .then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => rows.filter((i) => (i.nombre ?? "").toLowerCase().includes(q.toLowerCase())),
    [rows, q],
  );

  const totalTicketMax = rows.reduce((a, r) => a + (Number(r.ticket_max) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Inversores"
        title={t.nav.investors}
        subtitle={`${rows.length} inversores en CRM`}
        actions={<NewInvestorDialog onCreated={load} />}
      />
      <BetaBanner />

      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total inversores</Eyebrow><div className="mt-2"><MetricValue size="lg">{rows.length}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Capital agregado (max)</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="€">{totalTicketMax.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Tipologías cubiertas</Eyebrow><div className="mt-2"><MetricValue size="lg">{new Set(rows.flatMap((r) => r.tipos_activo ?? [])).size}</MetricValue></div></div></Card>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Briefcase} title="Sin inversores en cartera" description="Crea inversores para empezar a generar matches con tus activos." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar inversor…" className="h-8 pl-8 text-sm" />
            </div>
          </div>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-[220px]">Inversor</TableHead>
                <TableHead>Tipos de activo</TableHead>
                <TableHead className="text-right">Ticket min</TableHead>
                <TableHead className="text-right">Ticket max</TableHead>
                <TableHead>Ciudades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id} className="bg-card">
                  <TableCell className="font-medium text-foreground">{i.nombre}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(i.tipos_activo ?? []).map((tp: string) => (
                        <Badge key={tp} variant="outline">{tp}</Badge>
                      ))}
                      {(!i.tipos_activo || i.tipos_activo.length === 0) && <span className="text-muted-foreground">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.ticket_min ? <>{Number(i.ticket_min).toLocaleString()}<span className="ml-1 text-muted-foreground">€</span></> : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.ticket_max ? <>{Number(i.ticket_max).toLocaleString()}<span className="ml-1 text-muted-foreground">€</span></> : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {(i.ciudades ?? []).join(", ") || "—"}
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

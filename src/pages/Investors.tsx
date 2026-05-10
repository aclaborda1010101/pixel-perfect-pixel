import { useEffect, useState, useMemo } from "react";
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
import { BetaBanner } from "@/components/common/BetaBanner";
import { NewInvestorDialog } from "@/components/forms/NewEntityDialogs";
import { Briefcase, Search } from "lucide-react";

const PAGE_SIZE = 500;

// Inversores = owners cuyo metadatos->>'tipo_de_inversor' viene poblado desde HubSpot.
// Carga vía RPC paginada para evitar el límite default de PostgREST (1000 filas).
export default function Investors() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async (searchTerm: string) => {
    setLoading(true);
    try {
      const all: any[] = [];
      let offset = 0;
      let totalCount = 0;
      // Loop until we have all rows; each call also returns total_count.
      // Safety cap at 50 pages (=25k rows).
      for (let i = 0; i < 50; i++) {
        const { data, error } = await supabase.rpc("rpc_inversores_paginated", {
          p_search: searchTerm || null,
          p_limit: PAGE_SIZE,
          p_offset: offset,
        });
        if (error) { console.error("rpc_inversores_paginated", error); break; }
        if (!data || data.length === 0) break;
        all.push(...data);
        totalCount = Number(data[0]?.total_count ?? 0);
        if (all.length >= totalCount) break;
        offset += PAGE_SIZE;
      }
      setTotal(totalCount);
      setRows(all);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handle = setTimeout(() => load(search), search ? 250 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filtered = useMemo(
    () => rows.filter((i) => {
      const term = q.toLowerCase();
      if (!term) return true;
      return (
        (i.nombre ?? "").toLowerCase().includes(term) ||
        ((i.metadatos?.tipo_de_inversor ?? "") as string).toLowerCase().includes(term) ||
        ((i.metadatos?.distrito_zona ?? "") as string).toLowerCase().includes(term)
      );
    }),
    [rows, q],
  );

  const tipologias = useMemo(
    () => new Set(rows.map((r) => r.metadatos?.tipo_de_inversor).filter(Boolean)),
    [rows],
  );
  const conCapital = useMemo(
    () => rows.filter((r) => (r.metadatos?.capital_de_inversion ?? "") !== "").length,
    [rows],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Inversores"
        title={t.nav.investors}
        subtitle={loading ? "Cargando…" : `${total.toLocaleString("es-ES")} inversores en CRM · mostrando ${rows.length.toLocaleString("es-ES")}`}
        actions={<NewInvestorDialog onCreated={() => load(search)} />}
      />
      <BetaBanner />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total inversores</Eyebrow><div className="mt-2"><MetricValue size="lg">{total.toLocaleString("es-ES")}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Con capital declarado</Eyebrow><div className="mt-2"><MetricValue size="lg">{conCapital}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Tipologías cubiertas</Eyebrow><div className="mt-2"><MetricValue size="lg">{tipologias.size}</MetricValue></div></div></Card>
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState icon={Briefcase} title="Sin inversores en cartera" description="Crea inversores para empezar a generar matches con tus activos." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setSearch(e.target.value);
                }}
                placeholder="Buscar inversor…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              {loading ? "Cargando…" : `${filtered.length.toLocaleString("es-ES")} resultados`}
            </div>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {filtered.map((i) => (
              <li key={i.id} className="space-y-3 px-4 py-5">
                <div>
                  <Eyebrow>Inversor</Eyebrow>
                  <div className="text-base font-medium text-foreground break-words">{i.nombre}</div>
                </div>
                <div>
                  <Eyebrow>Tipo</Eyebrow>
                  <div className="mt-1.5">
                    {i.metadatos?.tipo_de_inversor
                      ? <Badge variant="outline">{i.metadatos.tipo_de_inversor}</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <Eyebrow>Capital</Eyebrow>
                    <div className="text-foreground break-words">{i.metadatos?.capital_de_inversion || "—"}</div>
                  </div>
                  <div className="text-right">
                    <Eyebrow>Zona</Eyebrow>
                    <div className="text-foreground break-words">{i.metadatos?.distrito_zona || "—"}</div>
                  </div>
                </div>
                <div>
                  <Eyebrow>Contacto</Eyebrow>
                  <div className="text-sm text-muted-foreground break-words">{[i.telefono, i.email].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="min-w-[220px]">Inversor</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Capital</TableHead>
                <TableHead>Zona / Distrito</TableHead>
                <TableHead>Contacto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.id} className="bg-card">
                  <TableCell className="font-medium text-foreground">{i.nombre}</TableCell>
                  <TableCell>
                    {i.metadatos?.tipo_de_inversor
                      ? <Badge variant="outline">{i.metadatos.tipo_de_inversor}</Badge>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-foreground">{i.metadatos?.capital_de_inversion || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{i.metadatos?.distrito_zona || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{[i.telefono, i.email].filter(Boolean).join(" · ") || "—"}</TableCell>
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

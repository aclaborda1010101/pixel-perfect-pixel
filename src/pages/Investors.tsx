import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { TablePagination } from "@/components/common/TablePagination";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { BetaBanner } from "@/components/common/BetaBanner";
import { NewInvestorDialog } from "@/components/forms/NewEntityDialogs";
import { Briefcase, Search } from "lucide-react";

// Inversores = owners cuyo metadatos->>'tipo_de_inversor' viene poblado desde HubSpot.
// 100% server-side: RPC con filtros + buscador + orden + paginación.
export default function Investors() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filtros + paginación
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [tipo, setTipo] = useState<string>("all");
  const [persona, setPersona] = useState<string>("all");
  const [orden, setOrden] = useState<"recent" | "alpha">("recent");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);

  // Catálogo de tipos (top 30 desde BD)
  const [tipos, setTipos] = useState<string[]>([]);
  const [tipologiasTotal, setTipologiasTotal] = useState(0);

  useEffect(() => { const t = setTimeout(() => setQDeb(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [qDeb, tipo, persona, orden, pageSize]);

  // Carga catálogo (1 sola vez)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("rpc_inversores_paginated", {
        p_search: null, p_tipo: null, p_buyer_persona: null, p_distrito: null,
        p_order: "recent", p_limit: 5000, p_offset: 0,
      } as any);
      const list = (data ?? []) as any[];
      const set = new Set(list.map(r => r.metadatos?.tipo_de_inversor).filter(Boolean));
      setTipos(Array.from(set).sort());
      setTipologiasTotal(set.size);
    })();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("rpc_inversores_paginated", {
      p_search: qDeb || null,
      p_tipo: tipo === "all" ? null : tipo,
      p_buyer_persona: persona === "all" ? null : persona,
      p_distrito: null,
      p_order: orden,
      p_limit: pageSize,
      p_offset: page * pageSize,
    } as any);
    if (error) console.error(error);
    const list = (data ?? []) as any[];
    setRows(list);
    setTotal(Number(list[0]?.total_count ?? 0));
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [qDeb, tipo, persona, orden, page, pageSize]);

  const conCapital = useMemo(
    () => rows.filter((r) => (r.metadatos?.capital_de_inversion ?? "") !== "").length,
    [rows],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Inversores"
        title={t.nav.investors}
        subtitle={loading ? "Cargando…" : `${total.toLocaleString("es-ES")} inversores en CRM`}
        actions={<NewInvestorDialog onCreated={() => load()} />}
      />
      <BetaBanner />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total inversores</Eyebrow><div className="mt-2"><MetricValue size="lg">{total.toLocaleString("es-ES")}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Tipologías cubiertas</Eyebrow><div className="mt-2"><MetricValue size="lg">{tipologiasTotal}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Con capital declarado (página)</Eyebrow><div className="mt-2"><MetricValue size="lg">{conCapital}</MetricValue></div></div></Card>
      </div>

      {total === 0 && !loading ? (
        <EmptyState icon={Briefcase} title="Sin inversores en cartera" description="Crea inversores para empezar a generar matches con tus activos." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar nombre, tipo, email, teléfono…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="h-8 w-[200px] text-sm"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">Tipo: todos</SelectItem>
                {tipos.map((tp) => <SelectItem key={tp} value={tp}>{tp}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={persona} onValueChange={setPersona}>
              <SelectTrigger className="h-8 w-[170px] text-sm"><SelectValue placeholder="Buyer persona" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Persona: todas</SelectItem>
                <SelectItem value="sin_clasificar">Sin clasificar</SelectItem>
                <SelectItem value="cansado">Cansado</SelectItem>
                <SelectItem value="desplazado">Desplazado</SelectItem>
                <SelectItem value="controla">Controla</SelectItem>
                <SelectItem value="ego">Ego</SelectItem>
                <SelectItem value="no_traspasa">No traspasa</SelectItem>
                <SelectItem value="vive_edificio">Vive edificio</SelectItem>
                <SelectItem value="no_primero">No primero</SelectItem>
              </SelectContent>
            </Select>
            <Select value={orden} onValueChange={(v) => setOrden(v as any)}>
              <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Más reciente</SelectItem>
                <SelectItem value="alpha">Alfabético</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {rows.map((i) => (
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
              {rows.length === 0 && !loading && (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sin coincidencias.</TableCell></TableRow>
              )}
              {rows.map((i) => (
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
          <TablePagination
            page={page} pageSize={pageSize} totalCount={total} loading={loading}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </Card>
      )}
    </div>
  );
}

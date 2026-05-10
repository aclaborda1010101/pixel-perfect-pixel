import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import { useTableQuery } from "@/hooks/useTableQuery";
import { useI18n } from "@/i18n/I18nProvider";
import { ValuatorButton } from "@/components/agents/ValuatorButton";
import { Boxes, Search } from "lucide-react";
import { NewAssetDialog } from "@/components/forms/NewEntityDialogs";

export default function Assets() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [tipo, setTipo] = useState<string>("all");
  const [estado, setEstado] = useState<string>("all");
  const [orden, setOrden] = useState<"recent" | "alpha" | "valor">("recent");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => { const t = setTimeout(() => setQDeb(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [qDeb, tipo, estado, orden, pageSize]);

  const orderCfg = useMemo(() => {
    if (orden === "alpha") return { column: "ubicacion", ascending: true };
    if (orden === "valor") return { column: "valoracion_estimada", ascending: false };
    return { column: "updated_at", ascending: false };
  }, [orden]);

  const { rows, totalCount, loading, refetch } = useTableQuery<any>({
    table: "assets",
    search: { term: qDeb, columns: ["ubicacion", "ciudad", "descripcion"] },
    filters: [
      { column: "tipo", op: "eq", value: tipo === "all" ? null : tipo },
      { column: "estado", op: "eq", value: estado === "all" ? null : estado },
    ],
    order: orderCfg,
    page, pageSize,
  });

  const totalVal = rows.reduce((a, r: any) => a + (Number(r.valoracion_estimada) || 0), 0);
  const totalSup = rows.reduce((a, r: any) => a + (Number(r.superficie_m2) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera · Activos"
        title={t.nav.assets}
        subtitle={`${totalCount.toLocaleString()} activos catalogados`}
        actions={<NewAssetDialog onCreated={refetch} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Total activos</Eyebrow><div className="mt-2"><MetricValue size="lg">{totalCount.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Superficie (página)</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="m²">{totalSup.toLocaleString()}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Valoración (página)</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="€">{totalVal.toLocaleString()}</MetricValue></div></div></Card>
      </div>

      {totalCount === 0 && !loading ? (
        <EmptyState
          icon={Boxes}
          title="Sin activos en el catálogo"
          description="Añade activos para asociarlos a propietarios y usarlos en briefings de llamadas."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border-faint px-4 py-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por ubicación, ciudad, descripción…"
                className="h-8 pl-8 text-sm"
              />
            </div>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="h-8 w-[150px] text-sm"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tipo: todos</SelectItem>
                <SelectItem value="vivienda">Vivienda</SelectItem>
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="oficina">Oficina</SelectItem>
                <SelectItem value="edificio">Edificio</SelectItem>
                <SelectItem value="suelo">Suelo</SelectItem>
              </SelectContent>
            </Select>
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger className="h-8 w-[150px] text-sm"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Estado: todos</SelectItem>
                <SelectItem value="prospecto">Prospecto</SelectItem>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="cerrado">Cerrado</SelectItem>
                <SelectItem value="descartado">Descartado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={orden} onValueChange={(v) => setOrden(v as any)}>
              <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Más reciente</SelectItem>
                <SelectItem value="alpha">Alfabético</SelectItem>
                <SelectItem value="valor">Mayor valoración</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-border-faint md:hidden">
            {rows.map((a: any) => (
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
              {rows.length === 0 && !loading && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Sin coincidencias.</TableCell></TableRow>
              )}
              {rows.map((a: any) => (
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
                    <ValuatorButton assetId={a.id} onDone={refetch} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <TablePagination
            page={page} pageSize={pageSize} totalCount={totalCount} loading={loading}
            onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        </Card>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useCorreccionesResumen } from "@/hooks/useCorreccionesPendientes";
import { PageHeader } from "@/components/common/PageHeader";
import { TablePagination } from "@/components/common/TablePagination";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, EyeOff, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { RevisionCoherencia } from "@/components/coherencia/RevisionCoherencia";
import {
  TIPOS_CORRECCION,
  TIPOS_DATOS,
  TIPOS_TRABAJO,
  esCorreccionDeDatos,
  tipoPorCodigo,
  etiquetaEstado,
  propuestaEnLlano,
  enlaceEntidad,
} from "@/lib/correcciones";

type Fila = {
  id: string;
  guarda: number;
  entity_type: string;
  entity_id: string;
  edificio_id: string | null;
  titulo: string;
  detalle: string | null;
  propuesta: Record<string, unknown> | null;
  estado: string;
  creado_at: string;
  resuelto_at: string | null;
  resuelto_por: string | null;
  motivo: string | null;
};

const ESTADOS_FILTRO = [
  "pendiente",
  "aprobada_pendiente_aplicacion",
  "aplicada",
  "rechazada",
  "obsoleta",
] as const;

export default function Correcciones() {
  const { role, loading: roleLoading } = useCurrentRole();
  const qc = useQueryClient();
  const [seccion, setSeccion] = useState<"datos" | "trabajo" | "coherencia">("datos");
  const [tipo, setTipo] = useState(String(TIPOS_DATOS[0].codigo));
  const [estado, setEstado] = useState<string>("pendiente");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [motivo, setMotivo] = useState("");
  const [working, setWorking] = useState(false);

  const permitido = role === "admin" || role === "sales_manager";
  const resumen = useCorreccionesResumen();
  const codigo = Number(tipo);
  const esDatos = esCorreccionDeDatos(codigo);

  const lista = useQuery({
    queryKey: ["correcciones-lista", codigo, estado, page, pageSize],
    enabled: permitido,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("correcciones_listado", {
        p_guarda: codigo,
        p_estado: estado,
        p_offset: page * pageSize,
        p_limite: pageSize,
      });
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as { rows?: Fila[]; total?: number };
      return { rows: (d.rows ?? []) as Fila[], total: Number(d.total ?? 0) };
    },
  });

  const rows = lista.data?.rows ?? [];
  const total = lista.data?.total ?? 0;
  const seleccionadas = useMemo(() => rows.filter((r) => sel[r.id]).map((r) => r.id), [rows, sel]);
  const todo = rows.length > 0 && seleccionadas.length === rows.length;

  const contar = (c: number, e: string) =>
    (resumen.data ?? []).find((r) => r.guarda === c && r.estado === e)?.total ?? 0;

  const totalDatosPendientes = TIPOS_DATOS.reduce((a, t) => a + contar(t.codigo, "pendiente"), 0);
  const totalTrabajoPendiente = TIPOS_TRABAJO.reduce((a, t) => a + contar(t.codigo, "pendiente"), 0);

  if (roleLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  if (!permitido) return <Navigate to="/" replace />;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["correcciones-lista"] });
    qc.invalidateQueries({ queryKey: ["correcciones-resumen"] });
  };

  const resolver = async (accion: "aprobar" | "rechazar", ids: string[] | null) => {
    setWorking(true);
    try {
      const { data, error } = await (supabase.rpc as any)("resolver_correcciones", {
        p_accion: accion,
        p_ids: ids,
        p_guarda: ids ? null : codigo,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw new Error(error.message);
      const d = (data ?? {}) as Record<string, number>;
      toast.success(accion === "aprobar" ? "Correcciones aprobadas" : "Correcciones rechazadas", {
        description:
          accion === "aprobar"
            ? `${d.aplicadas ?? 0} aplicadas · ${d.aprobadas_pendientes_aplicacion ?? 0} pendientes de aplicar`
            : `${d.rechazadas ?? 0} rechazadas`,
      });
      setSel({});
      setMotivo("");
      refrescar();
    } catch (e: any) {
      toast.error("No se pudo completar", { description: e?.message });
    } finally {
      setWorking(false);
    }
  };

  const meta = tipoPorCodigo(codigo);
  const editable = estado === "pendiente" && esDatos;
  const tiposVisibles = seccion === "datos" ? TIPOS_DATOS : TIPOS_TRABAJO;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Calidad de datos"
        title="Orquestador"
        subtitle={`${totalDatosPendientes.toLocaleString("es-ES")} correcciones de datos pendientes de revisar. Nada cambia hasta que alguien lo aprueba.`}
        actions={
          <Button variant="outline" size="sm" onClick={refrescar} disabled={lista.isFetching}>
            <RefreshCw className={`h-4 w-4 ${lista.isFetching ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      <Tabs
        value={seccion}
        onValueChange={(v) => {
          const s = v as "datos" | "trabajo" | "coherencia";
          setSeccion(s);
          if (s !== "coherencia") setTipo(String((s === "datos" ? TIPOS_DATOS : TIPOS_TRABAJO)[0].codigo));
          setEstado("pendiente");
          setSel({});
          setPage(0);
        }}
      >
        <TabsList>
          <TabsTrigger value="datos">
            Correcciones de datos
            <Badge variant="secondary" className="ml-2 font-mono tabular-nums">
              {totalDatosPendientes}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="trabajo">
            Trabajo comercial pendiente
            <Badge variant="outline" className="ml-2 font-mono tabular-nums">
              {totalTrabajoPendiente}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="coherencia">Revisión de coherencia</TabsTrigger>
        </TabsList>
      </Tabs>

      {seccion === "coherencia" && <RevisionCoherencia />}

      {seccion !== "coherencia" && (
        <>
      {seccion === "trabajo" && (
        <p className="text-sm text-muted-foreground">
          No son errores ni requieren acción manual: el generador de tareas los va sirviendo de uno en
          uno a cada comercial. Esta lista es solo para consultar.
        </p>
      )}

      <Tabs
        value={tipo}
        onValueChange={(v) => {
          setTipo(v);
          setSel({});
          setPage(0);
        }}
      >
        <TabsList className="flex-wrap">
          {tiposVisibles.map((t) => (
            <TabsTrigger key={t.codigo} value={String(t.codigo)}>
              {t.nombre}
              <Badge variant="secondary" className="ml-2 font-mono tabular-nums">
                {contar(t.codigo, "pendiente")}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{meta.descripcion}</p>
        {esDatos && (
          <p className="text-xs text-muted-foreground">
            {meta.automatico
              ? "Al aprobar, la app aplica el cambio automáticamente."
              : "Al aprobar, queda a la espera de aplicarse a mano (la app no puede hacerlo sola con seguridad)."}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ESTADOS_FILTRO.map((e) => (
          <Button
            key={e}
            size="sm"
            variant={estado === e ? "default" : "outline"}
            onClick={() => {
              setEstado(e);
              setPage(0);
              setSel({});
            }}
          >
            {etiquetaEstado(e)}
            <span className="ml-2 font-mono text-[11px] tabular-nums opacity-80">{contar(codigo, e)}</span>
          </Button>
        ))}
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={todo}
              onCheckedChange={(v) => {
                const next: Record<string, boolean> = {};
                if (v === true) rows.forEach((r) => { next[r.id] = true; });
                setSel(next);
              }}
            />
            Seleccionar esta página ({rows.length})
          </label>
          <span className="font-mono text-xs text-muted-foreground">{seleccionadas.length} seleccionadas</span>
          <Input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional)"
            className="h-8 w-56 text-xs"
          />
          <Button size="sm" disabled={working || !seleccionadas.length} onClick={() => resolver("aprobar", seleccionadas)}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Aprobar seleccionadas
          </Button>
          <Button size="sm" variant="outline" disabled={working || !seleccionadas.length}
            onClick={() => resolver("rechazar", seleccionadas)}>
            <EyeOff className="h-4 w-4" /> Rechazar seleccionadas
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={working || total === 0}
            onClick={() => {
              if (confirm(`¿Aprobar las ${total} correcciones pendientes de «${meta.nombre}»?`)) resolver("aprobar", null);
            }}
          >
            Aprobar todas de este tipo ({total})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={working || total === 0}
            onClick={() => {
              if (confirm(`¿Rechazar las ${total} correcciones pendientes de «${meta.nombre}»?`)) resolver("rechazar", null);
            }}
          >
            Rechazar todas
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const url = enlaceEntidad(r);
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                  {editable && (
                    <Checkbox
                      className="mt-1"
                      checked={!!sel[r.id]}
                      onCheckedChange={(v) => setSel((s) => ({ ...s, [r.id]: v === true }))}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{r.titulo}</div>
                    {r.detalle && <div className="mt-0.5 text-xs text-muted-foreground">{r.detalle}</div>}
                    <div className="mt-1 text-xs text-foreground/80">{propuestaEnLlano(r.guarda, r.propuesta)}</div>
                    {r.estado !== "pendiente" && (
                      <div className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {etiquetaEstado(r.estado)}
                        {r.resuelto_por ? ` · ${r.resuelto_por}` : ""}
                        {r.resuelto_at ? ` · ${new Date(r.resuelto_at).toLocaleDateString("es-ES")}` : ""}
                        {r.motivo ? ` · ${r.motivo}` : ""}
                      </div>
                    )}
                  </div>
                  {url && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to={url}>
                        <ExternalLink className="h-3.5 w-3.5" /> Ver
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
            {!rows.length && !lista.isFetching && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {seccion === "datos"
                  ? estado === "pendiente"
                    ? "No hay correcciones pendientes de este tipo"
                    : `No hay correcciones de este tipo en «${etiquetaEstado(estado)}»`
                  : "No hay trabajo comercial pendiente de este tipo"}
              </div>
            )}
            {lista.isFetching && !rows.length && (
              <div className="p-6 text-center text-sm text-muted-foreground">Cargando…</div>
            )}
          </div>
          <TablePagination
            page={page}
            pageSize={pageSize}
            totalCount={total}
            loading={lista.isFetching}
            onPageChange={(p) => { setPage(p); setSel({}); }}
            onPageSizeChange={(s) => { setPageSize(s); setPage(0); setSel({}); }}
          />
        </CardContent>
      </Card>
    </>
      )}
    </div>
  );
}

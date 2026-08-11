import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock } from "lucide-react";
import { ModosGeneracionCard } from "@/components/tareas/ModosGeneracionCard";
import { PERIODS, periodRange, type PeriodKey } from "@/lib/salesManagerMetrics";
import {
  agruparPorComercial,
  etiquetaTipo,
  fmtFecha,
  totales,
  type PanelData,
  type TareaPanel,
} from "@/lib/gestorPanel";

function usePanel(period: PeriodKey) {
  const { from, to } = periodRange(period);
  return useQuery({
    queryKey: ["gestor-panel", from.toISOString(), to.toISOString()],
    queryFn: async (): Promise<PanelData> => {
      const { data, error } = await (supabase.rpc as any)("get_sales_manager_panel", {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
      });
      if (error) throw new Error(error.message);
      return (data ?? { from: "", to: "", generated_at: "", activas: [], realizadas: [] }) as PanelData;
    },
    retry: 1,
  });
}

function TablaTareas({ rows, mostrarCierre }: { rows: TareaPanel[]; mostrarCierre?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Ninguna.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium">Tarea</th>
            <th className="py-1 pr-3 font-medium">Edificio</th>
            <th className="py-1 pr-3 font-medium">Inicio</th>
            <th className="py-1 pr-3 font-medium">{mostrarCierre ? "Realizada" : "Fecha límite"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t">
              <td className="py-1.5 pr-3">{etiquetaTipo(t.task_type)}</td>
              <td className="py-1.5 pr-3">{t.direccion || "—"}</td>
              <td className="py-1.5 pr-3 tabular-nums">{fmtFecha(t.started_at ?? t.created_at)}</td>
              <td className="py-1.5 pr-3 tabular-nums">
                {mostrarCierre ? fmtFecha(t.completed_at) : fmtFecha(t.due_date)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GestorComerciales() {
  const [period, setPeriod] = useState<PeriodKey>("semana");
  const q = usePanel(period);
  const grupos = useMemo(() => agruparPorComercial(q.data), [q.data]);
  const tot = totales(grupos);
  const error = q.error as Error | null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Panel del gestor comercial</h1>
        <p className="text-sm text-muted-foreground">
          Trabajo del equipo comercial: lo que tienen entre manos, lo que se ha retrasado y lo que ya
          han terminado.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Histórico de tareas realizadas:</span>
        {PERIODS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={period === p.key ? "default" : "outline"}
            onClick={() => setPeriod(p.key)}
          >
            {p.key === "hoy" ? "Hoy" : p.key === "semana" ? "Esta semana" : "Este mes"}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-base">No se han podido cargar los datos</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error.message}</CardContent>
        </Card>
      )}

      {q.isLoading && !error && (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {!q.isLoading && !error && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">Tareas activas (todo el equipo)</div>
              <div className="text-2xl font-semibold tabular-nums">{tot.activas}</div>
            </div>
            <div className={tot.retrasadas > 0 ? "rounded-md border border-destructive/50 p-4" : "rounded-md border p-4"}>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" /> Con retraso
              </div>
              <div className={tot.retrasadas > 0 ? "text-2xl font-semibold tabular-nums text-destructive" : "text-2xl font-semibold tabular-nums"}>
                {tot.retrasadas}
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-xs text-muted-foreground">Realizadas en el periodo</div>
              <div className="text-2xl font-semibold tabular-nums">{tot.realizadas}</div>
            </div>
          </div>

          {grupos.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sin tareas que mostrar</CardTitle>
                <CardDescription>
                  No hay tareas activas ni realizadas en el periodo seleccionado.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {grupos.map((g) => (
              <Card key={g.user_id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {g.nombre}
                    {g.retrasadas.length > 0 && (
                      <Badge variant="destructive">{g.retrasadas.length} con retraso</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {g.activas.length} activas · {g.realizadas.length} realizadas en el periodo
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Tareas activas (pendientes y en curso)
                    </div>
                    <TablaTareas rows={g.activas} />
                  </div>
                  {g.retrasadas.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-destructive">
                        Tareas con retraso ({g.retrasadas.length})
                      </div>
                      <TablaTareas rows={g.retrasadas} />
                    </div>
                  )}
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Tareas realizadas en el periodo
                    </div>
                    <TablaTareas rows={g.realizadas} mostrarCierre />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <ModosGeneracionCard />
    </div>
  );
}

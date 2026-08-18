import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { FlaskConical, Info, ShieldCheck } from "lucide-react";
import { periodRange } from "@/lib/salesManagerMetrics";
import { agruparPorComercial, type PanelData } from "@/lib/gestorPanel";
import { useHorarioLaboral } from "@/hooks/useHorarioLaboral";
import {
  actividadReal,
  AVISO_IMPORTES,
  AVISO_MAQUETA,
  COMPENSACION,
  INDICADORES,
  puntuarTodos,
  REGLAS_JUEGO_LIMPIO,
  SIN_DATOS,
  sumaPesos,
  textoMetrica,
  type Metrica,
} from "@/lib/productividad";

function usePanelMes() {
  const { from, to } = periodRange("mes");
  return useQuery({
    queryKey: ["gestor-productividad", from.toISOString(), to.toISOString()],
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

function Dato({ etiqueta, m }: { etiqueta: string; m: Metrica }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{etiqueta}</div>
      <div className="text-xl font-semibold tabular-nums">{textoMetrica(m)}</div>
      {!m.disponible && <div className="text-[11px] text-muted-foreground">{SIN_DATOS}</div>}
    </div>
  );
}

export function ProductividadTab() {
  const q = usePanelMes();
  const { horario } = useHorarioLaboral();
  const puntuaciones = useMemo(() => puntuarTodos(), []);
  const actividad = useMemo(() => {
    const grupos = agruparPorComercial(q.data, new Date(), horario);
    const retrasadas: Record<string, number> = {};
    for (const g of grupos) retrasadas[g.user_id] = g.retrasadas.length;
    return actividadReal(q.data, retrasadas, new Date());
  }, [q.data, horario]);
  const lider = puntuaciones.reduce((a, b) => (b.total > a.total ? b : a), puntuaciones[0]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-md border border-primary/40 bg-primary/5 p-4">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <div className="text-sm font-semibold">{AVISO_MAQUETA}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Nada de esta pestaña se guarda en la base de datos ni se envía a HubSpot.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Puntuación por comercial
            <Badge variant="secondary">Datos de ejemplo</Badge>
          </CardTitle>
          <CardDescription>
            Seis indicadores con sus pesos ({sumaPesos()} en total). La puntuación global va de 0 a 100.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {puntuaciones.map((p) => (
              <div key={p.nombre} className="rounded-md border p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    {p.nombre} <span className="text-xs text-muted-foreground">(ejemplo)</span>
                  </div>
                  {lider && p.nombre === lider.nombre && <Badge>Mejor puntuación</Badge>}
                </div>
                <div className="mt-1 text-3xl font-semibold tabular-nums">{p.total}</div>
                <Progress value={p.total} className="mt-2 h-2" />
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Indicador</th>
                  <th className="py-1.5 pr-3 font-medium">Peso</th>
                  {puntuaciones.map((p) => (
                    <th key={p.nombre} className="py-1.5 pr-3 font-medium">
                      {p.nombre}
                    </th>
                  ))}
                  <th className="py-1.5 font-medium">Cómo se mide</th>
                </tr>
              </thead>
              <tbody>
                {INDICADORES.map((ind, i) => (
                  <tr key={ind.id} className="border-t align-top">
                    <td className="py-2 pr-3">
                      <span className="text-muted-foreground">{ind.numero}.</span> {ind.nombre}
                      {ind.id === "rentas" && (
                        <Badge variant="outline" className="ml-2">
                          Determinante
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums font-medium">{ind.peso}%</td>
                    {puntuaciones.map((p) => (
                      <td key={p.nombre} className="py-2 pr-3 tabular-nums">
                        {p.lineas[i].logro}%{" "}
                        <span className="text-xs text-muted-foreground">
                          ({p.lineas[i].puntos} pts)
                        </span>
                      </td>
                    ))}
                    <td className="py-2 text-xs text-muted-foreground">{ind.comoSeMide}</td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/40">
                  <td className="py-2 pr-3 font-medium">Total</td>
                  <td className="py-2 pr-3 font-medium tabular-nums">{sumaPesos()}%</td>
                  {puntuaciones.map((p) => (
                    <td key={p.nombre} className="py-2 pr-3 font-semibold tabular-nums">
                      {p.total}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividad real del equipo</CardTitle>
          <CardDescription>
            Estos contadores sí salen de la aplicación. Donde todavía no hay dato se indica
            expresamente, nunca se muestra un cero.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {q.isLoading && <Skeleton className="h-24 w-full" />}
          {q.error && (
            <p className="text-sm text-muted-foreground">
              No se ha podido cargar la actividad: {(q.error as Error).message}
            </p>
          )}
          {!q.isLoading && !q.error && actividad.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin comerciales con actividad este mes.</p>
          )}
          {actividad.map((a) => (
            <div key={a.user_id} className="space-y-2">
              <div className="text-sm font-medium">{a.nombre}</div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Dato etiqueta="Tareas completadas hoy" m={a.hoy} />
                <Dato etiqueta="Esta semana" m={a.semana} />
                <Dato etiqueta="Este mes" m={a.mes} />
                <Dato etiqueta="Tareas con retraso" m={a.retrasadas} />
                <Dato etiqueta="Llamadas registradas" m={a.llamadas} />
                <Dato etiqueta="WhatsApp enviados" m={a.whatsapps} />
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Llamadas y WhatsApp aparecen como «{SIN_DATOS}» porque todavía no llegan atribuidos a
            cada comercial.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cómo se convierte en compensación</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" /> {AVISO_IMPORTES}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {COMPENSACION.map((b, i) => (
              <div key={b.titulo}>
                {i > 0 && <Separator className="mb-3" />}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{b.titulo}</span>
                  <Badge variant="outline">{b.indicadores}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{b.detalle}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" /> Reglas de juego limpio
            </CardTitle>
            <CardDescription>Cómo se evita que la puntuación sea injusta.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              {REGLAS_JUEGO_LIMPIO.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useSalesManagerDashboard } from "@/hooks/useSalesManagerDashboard";
import { ModosTareasCard } from "@/components/gestor/ModosTareasCard";
import {
  PERIODS,
  completionRate,
  coberturaNota,
  fmtHoras,
  mezclaEntries,
  periodRange,
  type PeriodKey,
  type SalesManagerRow,
} from "@/lib/salesManagerMetrics";

export default function GestorComerciales() {
  const [period, setPeriod] = useState<PeriodKey>("semana");
  const [comercial, setComercial] = useState<string>("todos");
  const q = useSalesManagerDashboard(period);

  const range = useMemo(() => periodRange(period), [period]);
  const rows: SalesManagerRow[] = q.data?.rows ?? [];
  const visibles = comercial === "todos" ? rows : rows.filter((r) => r.user_id === comercial);
  const error = q.error as Error | null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Gestión comercial</h1>
        <p className="text-sm text-muted-foreground">
          Agregados servidos por el backend (sin acceso a títulos, edificios ni propietarios).
          Intervalo [{range.from.toLocaleDateString("es-ES")} – {range.to.toLocaleDateString("es-ES")}) en hora de Madrid.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <Button key={p.key} size="sm" variant={period === p.key ? "default" : "outline"} onClick={() => setPeriod(p.key)}>
            {p.label}
          </Button>
        ))}
        <span className="mx-2 hidden h-5 w-px bg-border md:block" />
        <Button size="sm" variant={comercial === "todos" ? "default" : "outline"} onClick={() => setComercial("todos")}>
          Todos
        </Button>
        {rows.map((r) => (
          <Button
            key={r.user_id}
            size="sm"
            variant={comercial === r.user_id ? "default" : "outline"}
            onClick={() => setComercial(r.user_id)}
          >
            {r.full_name || r.user_id.slice(0, 8)}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-base">Error al cargar los datos</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{error.message}</CardContent>
        </Card>
      )}

      {q.isLoading && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!q.isLoading && !error && visibles.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sin tareas en el periodo seleccionado</CardTitle>
            <CardDescription>Prueba a ampliar el periodo o quitar el filtro por comercial.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!q.isLoading && !error && visibles.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {visibles.map((u) => (
            <Card key={u.user_id}>
              <CardHeader>
                <CardTitle className="text-base">{u.full_name || u.user_id.slice(0, 8)}</CardTitle>
                <CardDescription>{u.creadas} tareas creadas en el periodo</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ["Completadas", u.completadas],
                    ["Pendientes", u.pending],
                    ["En curso", u.in_progress],
                    ["Bloqueadas", u.blocked],
                    ["No procede", u.skipped],
                    ["Desconocido", u.unknown],
                    ["Vencidas", u.vencidas],
                    ["En plazo", u.en_plazo],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-xl font-semibold tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Cumplimiento de plazo</div>
                    <div className="text-xl font-semibold tabular-nums">
                      {completionRate(u) == null ? "—" : `${completionRate(u)}%`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {u.con_plazo} tareas con fecha límite y cierre
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Duración inicio → cierre</div>
                    <div className="text-sm font-semibold tabular-nums">
                      media {fmtHoras(u.media_horas)} · mediana {fmtHoras(u.mediana_horas)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{coberturaNota(u)}</div>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Mezcla por grupo</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {mezclaEntries(u).length === 0 && <span className="text-muted-foreground">—</span>}
                    {mezclaEntries(u).map(([code, n]) => (
                      <span key={code} className="rounded-md border px-2 py-1 tabular-nums">
                        {code}: {n}
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ModosTareasCard />
    </div>
  );
}

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/common/Eyebrow";
import { TaskScheduleMeta, TaskTemporalBadge } from "@/components/comercial/TaskScheduleMeta";
import { madridYmd, taskCode, taskSubjectId } from "@/lib/taskSchedule";
import { AlertTriangle } from "lucide-react";

type Task = {
  id: string;
  building_id: string | null;
  user_id: string | null;
  task_type: string | null;
  task_key: string | null;
  title: string | null;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  created_at: string | null;
  status: string | null;
};

const ownerIdFromKey = (k?: string | null) => taskSubjectId({ task_key: k });

export function ColaDemo() {
  const hoy = madridYmd(new Date());

  const { data, isLoading, error } = useQuery({
    queryKey: ["cola-demo", hoy],
    queryFn: async () => {
      const { data: tasks, error: e1 } = await supabase
        .from("building_tasks")
        .select("id,building_id,user_id,task_type,task_key,title,description,priority,due_date,created_at,status")
        .like("task_key", `v5:${hoy}:%`)
        .limit(60);
      if (e1) throw e1;
      const list = (tasks ?? []) as Task[];

      const ownerIds = [...new Set(list.map((t) => ownerIdFromKey(t.task_key)).filter(Boolean))] as string[];
      const buildingIds = [...new Set(list.map((t) => t.building_id).filter(Boolean))] as string[];
      const userIds = [...new Set(list.map((t) => t.user_id).filter(Boolean))] as string[];

      const [owners, buildings, profiles, sim] = await Promise.all([
        ownerIds.length ? supabase.from("owners").select("id,nombre").in("id", ownerIds) : Promise.resolve({ data: [] } as any),
        buildingIds.length ? supabase.from("buildings").select("id,direccion").in("id", buildingIds) : Promise.resolve({ data: [] } as any),
        userIds.length ? supabase.from("profiles").select("id,full_name,email").in("id", userIds) : Promise.resolve({ data: [] } as any),
        buildingIds.length
          ? (supabase.from("v_cola_simulada" as any) as any).select("building_id,owner_id,bloqueos").in("building_id", buildingIds)
          : Promise.resolve({ data: [] } as any),
      ]);

      const oMap = new Map((owners.data ?? []).map((o: any) => [o.id, o.nombre]));
      const bMap = new Map((buildings.data ?? []).map((b: any) => [b.id, b.direccion]));
      const pMap = new Map((profiles.data ?? []).map((p: any) => [p.id, p.full_name || p.email]));
      const sMap = new Map<string, string[]>(
        (sim.data ?? []).map((s: any) => [`${s.building_id}|${s.owner_id}`, (s.bloqueos ?? []) as string[]]),
      );

      return list.map((t) => {
        const ownerId = ownerIdFromKey(t.task_key);
        const key = `${t.building_id}|${ownerId}`;
        return {
          task: t,
          ownerId,
          comercial: (pMap.get(t.user_id ?? "") as string) ?? "Sin asignar",
          owner: (oMap.get(ownerId ?? "") as string) ?? null,
          direccion: (bMap.get(t.building_id ?? "") as string) ?? null,
          tipo: taskCode(t) ?? "T-—",
          bloqueos: sMap.has(key) ? (sMap.get(key) as string[]) : (null as string[] | null),
        };
      });
    },
    staleTime: 60_000,
  });

  const rows = data ?? [];
  const porComercial = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.comercial, (m.get(r.comercial) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.tipo, (m.get(r.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="space-y-4">
      <Card className="border-destructive/50 bg-destructive/10">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-eyebrow text-destructive">
              SIMULACIÓN · no publica en HubSpot · no penaliza · datos pendientes de confirmar
            </p>
            <p className="text-xs text-muted-foreground">
              Si estos datos se confirman, esta sería la tarea; si no, se recalcula o descarta.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Badge className="bg-amber-400/15 text-amber-500 border-transparent">{rows.length} propuestas</Badge>
        {porComercial.map(([c, n]) => (
          <Badge key={c} variant="outline" className="text-[10px]">{c} · {n}</Badge>
        ))}
        {porTipo.map(([t, n]) => (
          <Badge key={t} variant="secondary" className="text-[10px]">{t} · {n}</Badge>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">No se pudo cargar la demostración: {(error as any)?.message}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay lote del motor V5 planificado para hoy ({hoy}).</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.task.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Eyebrow>{r.comercial}</Eyebrow>
                  <Badge variant="secondary" className="text-[10px]">{r.tipo}</Badge>
                  <Badge variant="outline" className="text-[10px]">Prioridad {r.task.priority ?? "—"}</Badge>
                  <TaskTemporalBadge task={r.task} />
                </div>
                <CardTitle className="text-base">{r.task.title}</CardTitle>
                <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  {r.direccion ?? "Sin dirección"} · {r.owner ?? "Propietario sin nombre"}
                </div>
                <TaskScheduleMeta task={r.task} />
              </CardHeader>
              <CardContent className="space-y-3">
                {r.task.description && (
                  <pre className="whitespace-pre-wrap rounded-[4px] border border-border-faint bg-surface-1/40 p-3 font-sans text-xs text-muted-foreground">
                    {r.task.description}
                  </pre>
                )}
                <div className="rounded-[4px] border border-amber-400/30 bg-amber-400/5 p-3">
                  <Eyebrow>Supuestos todavía no verificados</Eyebrow>
                  {r.bloqueos === null ? (
                    <p className="pt-1 text-xs text-muted-foreground">
                      Sin evaluación en la simulación para esta pareja edificio–propietario.
                    </p>
                  ) : r.bloqueos.length === 0 ? (
                    <p className="pt-1 text-xs text-muted-foreground">Sin supuestos pendientes.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                      {r.bloqueos.map((b) => (
                        <Badge key={b} variant="destructive" className="text-[10px]">{b}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                {r.task.building_id && (
                  <Link
                    to={`/comercial/edificios/${r.task.building_id}`}
                    className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Ver ficha
                  </Link>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { sortByDueThenPriority, madridYmd, formatDate, plannedDate } from "@/lib/taskSchedule";
import { TaskTemporalBadge } from "@/components/comercial/TaskScheduleMeta";
import { toast } from "sonner";
import { Flame, Snowflake, ArrowRight, Loader2, RefreshCw, Phone } from "lucide-react";

export function ColaHoyCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [assigning, setAssigning] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["cola-hoy", userId],
    queryFn: async () => {
      const { data: tasks } = await (supabase.from("building_tasks" as any) as any)
        .select("id, title, description, priority, building_id, task_key, status, due_date, created_at")
        .eq("user_id", userId)
        .eq("task_type", "call_queue")
        .eq("status", "pending")
        .order("priority");
      return sortByDueThenPriority((tasks ?? []) as any[]);
    },
  });

  async function generar() {
    setAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke("assign_daily_call_queue", { body: { user_id: userId, n: 20 } });
      if (error) throw error;
      toast.success(`Cola generada · ${(data as any)?.inserted ?? 0} llamadas`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["comercial:dashboard"] });
    } catch (e: any) { toast.error(e?.message ?? "Error generando cola"); }
    finally { setAssigning(false); }
  }

  const items = data ?? [];
  const today = madridYmd(new Date());
  const hoyCount = items.filter((t: any) => {
    const p = plannedDate(t)?.iso;
    return p ? madridYmd(p) === today : false;
  }).length;
  const siguiente = items[0];
  const ownerIdMatch = siguiente?.task_key?.split(":")?.[2];

  return (
    <Card className="border-gold/30">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <Eyebrow><Phone className="mr-1 inline h-3 w-3 text-gold" /> Cola de llamadas</Eyebrow>
          <CardTitle>
            {items.length} llamadas asignadas · {hoyCount} para hoy
          </CardTitle>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={generar} disabled={assigning}>
            {assigning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {items.length === 0 ? "Generar cola" : "Regenerar"}
          </Button>
          {siguiente && ownerIdMatch && (
            <Button asChild size="sm" variant="gold">
              <Link to={`/comercial/preparar/${ownerIdMatch}`}>Siguiente llamada <ArrowRight className="h-3 w-3" /></Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{isLoading ? "Cargando…" : "Aún no tienes cola. Pulsa Generar cola para que el sistema seleccione hoy 20 propietarios alternando calientes (60%) y fríos (40%)."}</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {items.slice(0, 12).map((t: any) => {
              const ownerId = t.task_key?.split(":")?.[2];
              const isHot = t.priority === "high";
              const planned = plannedDate(t);
              return (
                <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <Badge variant={isHot ? "destructive" : "outline"} className="text-[10px]">
                    {isHot ? <Flame className="mr-0.5 h-2.5 w-2.5" /> : <Snowflake className="mr-0.5 h-2.5 w-2.5" />}
                    {isHot ? "Hot" : "Cold"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-foreground">{t.title}</div>
                    <div className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      Planificada desde: {planned ? formatDate(planned.iso) : "—"} · Fecha límite:{" "}
                      {formatDate(t.due_date) ?? "Sin fecha límite"}
                    </div>
                  </div>
                  <TaskTemporalBadge task={t} />
                  {ownerId && (
                    <Button asChild size="sm" variant="ghost">
                      <Link to={`/comercial/preparar/${ownerId}`}>Preparar <ArrowRight className="h-3 w-3" /></Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
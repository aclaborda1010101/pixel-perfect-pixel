import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Building2, ArrowRight } from "lucide-react";

function scoreVariant(s: number): "gold" | "success" | "info" | "outline" {
  if (s >= 80) return "gold";
  if (s >= 60) return "success";
  if (s >= 40) return "info";
  return "outline";
}

export default function ComercialEdificios() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["comercial:edificios", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data: assignments } = await (supabase.from("building_assignments" as any) as any)
        .select("building_id")
        .eq("user_id", userId);
      const ids: string[] = (assignments ?? []).map((a: any) => a.building_id);
      if (ids.length === 0) return { rows: [] as any[] };

      const [{ data: scores }, { data: owners }, { data: calls }] = await Promise.all([
        (supabase.from("v_building_score" as any) as any).select("*").in("id", ids),
        (supabase.from("v_owner_score" as any) as any)
          .select("owner_id,building_id,contactos_previos,last_call_at")
          .in("building_id", ids),
        supabase.from("calls").select("fecha,owner_id").order("fecha", { ascending: false }).limit(1000),
      ]);

      const ownersByB = new Map<string, any[]>();
      (owners ?? []).forEach((o: any) => {
        const arr = ownersByB.get(o.building_id) ?? [];
        arr.push(o); ownersByB.set(o.building_id, arr);
      });

      const rows = (scores ?? []).map((b: any) => {
        const list = ownersByB.get(b.id) ?? [];
        const contactados = list.filter((o) => (o.contactos_previos ?? 0) > 0).length;
        const lastByList = list
          .map((o) => o.last_call_at)
          .filter(Boolean)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
        return {
          id: b.id,
          direccion: b.direccion,
          ciudad: b.ciudad,
          score: Number(b.score ?? 0),
          num_viviendas: b.num_viviendas,
          m2_total: b.m2_total,
          ownersTotal: list.length,
          ownersContactados: contactados,
          lastContact: lastByList,
        };
      }).sort((a: any, b: any) => b.score - a.score);
      return { rows };
    },
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cartera"
        title="Mis edificios asignados"
        subtitle={`${rows.length} edificios en tu cartera comercial`}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={isLoading ? "Cargando…" : "No tienes edificios asignados"}
          description="Contacta con tu administrador para que te asigne tu cartera."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r: any) => {
            const cov = r.ownersTotal > 0 ? (r.ownersContactados / r.ownersTotal) * 100 : 0;
            return (
              <Card key={r.id} className="overflow-hidden">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Eyebrow>{r.ciudad ?? "—"}</Eyebrow>
                      <h3 className="mt-1 truncate text-base font-medium text-foreground">{r.direccion}</h3>
                    </div>
                    <Badge variant={scoreVariant(r.score)} className="shrink-0 font-mono tabular-nums">
                      {r.score.toFixed(0)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-y border-border-faint py-2 text-center">
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Viviendas</div>
                      <div className="font-mono text-sm tabular-nums text-foreground">{r.num_viviendas ?? "—"}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">m²</div>
                      <div className="font-mono text-sm tabular-nums text-foreground">{r.m2_total ? Number(r.m2_total).toLocaleString() : "—"}</div>
                    </div>
                    <div>
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Contactados</div>
                      <div className="font-mono text-sm tabular-nums text-foreground">{r.ownersContactados}/{r.ownersTotal}</div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      <span>Cobertura</span><span>{cov.toFixed(0)}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                      <div className="h-full bg-gold/80" style={{ width: `${cov}%` }} />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                      {r.lastContact ? `Últ. ${new Date(r.lastContact).toLocaleDateString("es")}` : "Sin contactos"}
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/comercial/edificios/${r.id}`}>Ver detalle <ArrowRight className="ml-1 h-3 w-3" /></Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
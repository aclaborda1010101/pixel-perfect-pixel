import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Building2, ArrowRight, Search, Home, Ruler, Users } from "lucide-react";
import {
  ScorePill,
  scoreTier,
  tierBarClass,
  tierTextClass,
  buildingScoreFactors,
} from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  direccion: string;
  ciudad: string | null;
  score: number;
  num_viviendas: number | null;
  m2_total: number | null;
  owners_count: number | null;
  division_horizontal: boolean;
  raw: any;
  assigned: boolean;
};

function BuildingCard({ r }: { r: Row }) {
  const tier = scoreTier(r.score);
  const factors = buildingScoreFactors(r.raw);
  const top3 = factors.slice(0, 3);
  const ratio =
    r.m2_total && r.num_viviendas ? Number(r.m2_total) / Number(r.num_viviendas) : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eyebrow>{r.ciudad ?? "—"}</Eyebrow>
              {r.assigned && (
                <Badge variant="gold" className="h-4 px-1.5 text-[9px]">
                  Tu cartera
                </Badge>
              )}
            </div>
            <h3 className="mt-1 truncate text-base font-medium text-foreground">{r.direccion}</h3>
          </div>
          <ScorePill score={r.score} />
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-md border border-border-faint bg-surface-1/40 p-2 text-center">
          <div>
            <Home className="mx-auto mb-0.5 h-3 w-3 text-muted-foreground" />
            <div className="font-mono text-sm tabular-nums text-foreground">
              {r.num_viviendas ?? "—"}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
              viviendas
            </div>
          </div>
          <div>
            <Ruler className="mx-auto mb-0.5 h-3 w-3 text-muted-foreground" />
            <div className="font-mono text-sm tabular-nums text-foreground">
              {r.m2_total ? Number(r.m2_total).toLocaleString() : "—"}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
              m² tot
            </div>
          </div>
          <div>
            <Users className="mx-auto mb-0.5 h-3 w-3 text-muted-foreground" />
            <div className="font-mono text-sm tabular-nums text-foreground">
              {ratio ? ratio.toFixed(0) : "—"}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
              m²/viv
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          {top3.map((f) => {
            const t = scoreTier(f.pct);
            return (
              <div key={f.label} className="space-y-0.5">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  <span>{f.label}</span>
                  <span className={tierTextClass[t]}>+{f.pts.toFixed(1)}</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-1">
                  <div
                    className={cn("h-full", tierBarClass[t])}
                    style={{ width: `${Math.max(2, f.pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className={cn("font-mono text-[10px] uppercase tracking-eyebrow", tierTextClass[tier])}>
            Potencial {tier === "high" ? "alto" : tier === "mid" ? "medio" : "bajo"}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link to={`/comercial/edificios/${r.id}`}>
              Ver detalle <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ComercialEdificios() {
  const { user } = useAuth();
  const userId = user?.id;
  const [tab, setTab] = useState<"mia" | "todos">("mia");
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["comercial:edificios:all", userId],
    enabled: !!userId,
    queryFn: async () => {
      const [{ data: assignments }, { data: scores }] = await Promise.all([
        (supabase.from("building_assignments" as any) as any)
          .select("building_id")
          .eq("user_id", userId)
          .eq("status", "active"),
        (supabase.from("v_building_score" as any) as any)
          .select("*")
          .order("score", { ascending: false })
          .limit(500),
      ]);
      const assignedIds = new Set<string>((assignments ?? []).map((a: any) => a.building_id));
      const rows: Row[] = (scores ?? []).map((b: any) => ({
        id: b.id,
        direccion: b.direccion,
        ciudad: b.ciudad,
        score: Number(b.score ?? 0),
        num_viviendas: b.num_viviendas,
        m2_total: b.m2_total,
        owners_count: b.owners_count,
        division_horizontal: !!b.division_horizontal,
        raw: b,
        assigned: assignedIds.has(b.id),
      }));
      return { rows };
    },
  });

  const rows = data?.rows ?? [];
  const mias = useMemo(() => rows.filter((r) => r.assigned), [rows]);
  const todos = rows;

  const filter = (list: Row[]) => {
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (r) =>
        r.direccion?.toLowerCase().includes(s) ||
        (r.ciudad ?? "").toLowerCase().includes(s),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Edificios"
        title="Cartera y catálogo"
        subtitle={`${mias.length} en tu cartera · ${todos.length} edificios totales`}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="mia">Mi cartera ({mias.length})</TabsTrigger>
            <TabsTrigger value="todos">Todos los edificios ({todos.length})</TabsTrigger>
          </TabsList>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por dirección o ciudad…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-72 pl-7"
            />
          </div>
        </div>

        <TabsContent value="mia" className="mt-0">
          {filter(mias).length === 0 ? (
            <EmptyState
              icon={Building2}
              title={isLoading ? "Cargando…" : "Sin edificios en tu cartera"}
              description="Contacta con tu administrador para que te asigne edificios. Mientras tanto puedes consultar el catálogo en la pestaña 'Todos los edificios'."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filter(mias).map((r) => (
                <BuildingCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="todos" className="mt-0">
          {filter(todos).length === 0 ? (
            <EmptyState
              icon={Building2}
              title={isLoading ? "Cargando catálogo…" : "Sin resultados"}
              description="Ajusta la búsqueda o vuelve a intentarlo."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filter(todos).map((r) => (
                <BuildingCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

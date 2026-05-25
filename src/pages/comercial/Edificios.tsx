import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { EmptyState } from "@/components/common/EmptyState";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Building2,
  ArrowRight,
  Search,
  Home,
  Ruler,
  Users,
  SlidersHorizontal,
  MapPin,
  X,
} from "lucide-react";
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
  barrio: string | null;
  distrito: string | null;
  score: number;
  num_viviendas: number | null;
  m2_total: number | null;
  owners_count: number | null;
  division_horizontal: boolean;
  ratio: number | null;
  raw: any;
  assigned: boolean;
  cartera_demo: boolean;
};

type SortKey =
  | "score_desc"
  | "score_asc"
  | "viviendas_desc"
  | "m2_desc"
  | "ratio_desc"
  | "owners_desc";

const SORT_LABELS: Record<SortKey, string> = {
  score_desc: "Score ↓",
  score_asc: "Score ↑",
  viviendas_desc: "Nº viviendas ↓",
  m2_desc: "M² totales ↓",
  ratio_desc: "Ratio m²/viv ↓",
  owners_desc: "Nº propietarios ↓",
};

function BuildingCard({ r }: { r: Row }) {
  const tier = scoreTier(r.score);
  const factors = buildingScoreFactors(r.raw);
  const top3 = factors.slice(0, 3);

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eyebrow>{r.barrio ?? r.ciudad ?? "—"}</Eyebrow>
              {r.assigned && (
                <Badge variant="gold" className="h-4 px-1.5 text-[9px]">
                  Tu cartera
                </Badge>
              )}
              {r.cartera_demo && (
                <Badge
                  className="h-4 border-0 bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 text-[9px] text-white"
                >
                  DEMO 25/05
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
              {r.ratio ? r.ratio.toFixed(0) : "—"}
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
  const [searchParams] = useSearchParams();
  const urlFilter = searchParams.get("filter");
  const [tab, setTab] = useState<"mia" | "todos">("mia");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("score_desc");
  const [scoreMin, setScoreMin] = useState<string>("");
  const [scoreMax, setScoreMax] = useState<string>("");
  const [vivMin, setVivMin] = useState<string>("");
  const [vivMax, setVivMax] = useState<string>("");
  const [dh, setDh] = useState<"all" | "yes" | "no">("all");
  const [barrios, setBarrios] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["comercial:edificios:all", userId],
    enabled: !!userId,
    queryFn: async () => {
      // Fetch all scored buildings paginated (Supabase caps each request at 1000 rows).
      const PAGE = 1000;
      const fetchPage = (from: number) =>
        (supabase.from("v_building_score" as any) as any)
          .select("*")
          .order("score", { ascending: false })
          .range(from, from + PAGE - 1);
      const [{ data: assignments }, { data: demoBldgs }, firstPage] = await Promise.all([
        (supabase.from("building_assignments" as any) as any)
          .select("building_id")
          .eq("user_id", userId)
          .eq("status", "active"),
        (supabase.from("buildings" as any) as any)
          .select("id")
          .eq("cartera_demo_seed", true),
        fetchPage(0),
      ]);
      let scores: any[] = firstPage.data ?? [];
      let from = PAGE;
      while (scores.length === from) {
        const next = await fetchPage(from);
        const chunk = next.data ?? [];
        if (!chunk.length) break;
        scores = scores.concat(chunk);
        if (chunk.length < PAGE) break;
        from += PAGE;
      }
      const assignedIds = new Set<string>((assignments ?? []).map((a: any) => a.building_id));
      const demoIds = new Set<string>((demoBldgs ?? []).map((b: any) => b.id));
      const rows: Row[] = (scores ?? []).map((b: any) => {
        const m2 = b.m2_total != null ? Number(b.m2_total) : null;
        const viv = b.num_viviendas != null ? Number(b.num_viviendas) : null;
        return {
          id: b.id,
          direccion: b.direccion,
          ciudad: b.ciudad,
          barrio: b.barrio ?? null,
          distrito: b.distrito ?? null,
          score: Number(b.score ?? 0),
          num_viviendas: viv,
          m2_total: m2,
          owners_count: b.owners_count,
          division_horizontal: !!b.division_horizontal,
          ratio: m2 && viv ? m2 / viv : null,
          raw: b,
          assigned: assignedIds.has(b.id),
          cartera_demo: demoIds.has(b.id),
        };
      });
      return { rows };
    },
  });

  const rows = data?.rows ?? [];
  // "Mi cartera" = asignados al user actual OR cartera_demo_seed=true
  const mias = useMemo(
    () => rows.filter((r) => r.assigned || r.cartera_demo),
    [rows],
  );
  // Si la URL trae ?filter=cartera_demo aplicamos solo demo y forzamos sort score desc
  const carteraDemoOnly = urlFilter === "cartera_demo";

  useEffect(() => {
    if (carteraDemoOnly) {
      setTab("mia");
      setSort("score_desc");
    }
  }, [carteraDemoOnly]);

  const visibleMias = useMemo(
    () => (carteraDemoOnly ? mias.filter((r) => r.cartera_demo) : mias),
    [mias, carteraDemoOnly],
  );

  const allBarrios = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.barrio && set.add(r.barrio));
    return Array.from(set).sort();
  }, [rows]);

  const apply = (list: Row[]) => {
    const s = q.trim().toLowerCase();
    const smin = scoreMin === "" ? -Infinity : Number(scoreMin);
    const smax = scoreMax === "" ? Infinity : Number(scoreMax);
    const vmin = vivMin === "" ? -Infinity : Number(vivMin);
    const vmax = vivMax === "" ? Infinity : Number(vivMax);

    let out = list.filter((r) => {
      if (s) {
        const hay =
          r.direccion?.toLowerCase().includes(s) ||
          (r.ciudad ?? "").toLowerCase().includes(s) ||
          (r.barrio ?? "").toLowerCase().includes(s);
        if (!hay) return false;
      }
      if (r.score < smin || r.score > smax) return false;
      const v = r.num_viviendas ?? 0;
      if (v < vmin || v > vmax) return false;
      if (dh === "yes" && !r.division_horizontal) return false;
      if (dh === "no" && r.division_horizontal) return false;
      if (barrios.size > 0 && (!r.barrio || !barrios.has(r.barrio))) return false;
      return true;
    });

    const cmp = (a: Row, b: Row) => {
      switch (sort) {
        case "score_asc":
          return a.score - b.score;
        case "viviendas_desc":
          return (b.num_viviendas ?? -1) - (a.num_viviendas ?? -1);
        case "m2_desc":
          return (Number(b.m2_total) || -1) - (Number(a.m2_total) || -1);
        case "ratio_desc":
          return (b.ratio ?? -1) - (a.ratio ?? -1);
        case "owners_desc":
          return (b.owners_count ?? -1) - (a.owners_count ?? -1);
        case "score_desc":
        default:
          return b.score - a.score;
      }
    };
    out = [...out].sort(cmp);
    return out;
  };

  const toggleBarrio = (b: string) => {
    setBarrios((prev) => {
      const n = new Set(prev);
      n.has(b) ? n.delete(b) : n.add(b);
      return n;
    });
  };

  const clearFilters = () => {
    setQ("");
    setScoreMin("");
    setScoreMax("");
    setVivMin("");
    setVivMax("");
    setDh("all");
    setBarrios(new Set());
  };

  const activeFiltersCount =
    (scoreMin !== "" ? 1 : 0) +
    (scoreMax !== "" ? 1 : 0) +
    (vivMin !== "" ? 1 : 0) +
    (vivMax !== "" ? 1 : 0) +
    (dh !== "all" ? 1 : 0) +
    (barrios.size > 0 ? 1 : 0);

  const filteredMias = apply(visibleMias);
  const filteredTodos = apply(rows);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Edificios"
        title="Cartera y catálogo"
        subtitle={`${mias.length} en tu cartera · ${rows.length} edificios totales`}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="mia">Mi cartera ({mias.length})</TabsTrigger>
            <TabsTrigger value="todos">Todos los edificios ({rows.length})</TabsTrigger>
          </TabsList>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por dirección, ciudad o barrio…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-80 pl-7"
            />
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-faint bg-surface-1/40 px-3 py-2">
          <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Score
            </span>
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="min"
              value={scoreMin}
              onChange={(e) => setScoreMin(e.target.value)}
              className="h-8 w-16 text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="max"
              value={scoreMax}
              onChange={(e) => setScoreMax(e.target.value)}
              className="h-8 w-16 text-xs"
            />
          </div>

          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Viv.
            </span>
            <Input
              type="number"
              min={0}
              placeholder="min"
              value={vivMin}
              onChange={(e) => setVivMin(e.target.value)}
              className="h-8 w-16 text-xs"
            />
            <span className="text-muted-foreground">–</span>
            <Input
              type="number"
              min={0}
              placeholder="max"
              value={vivMax}
              onChange={(e) => setVivMax(e.target.value)}
              className="h-8 w-16 text-xs"
            />
          </div>

          <Select value={dh} onValueChange={(v) => setDh(v as any)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">DH: todos</SelectItem>
              <SelectItem value="no" className="text-xs">Sin div. horizontal</SelectItem>
              <SelectItem value="yes" className="text-xs">Con div. horizontal</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <MapPin className="h-3 w-3" />
                Barrio
                {barrios.size > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {barrios.size}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Filtrar por barrio</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allBarrios.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Sin barrios</div>
              )}
              {allBarrios.map((b) => (
                <DropdownMenuCheckboxItem
                  key={b}
                  checked={barrios.has(b)}
                  onCheckedChange={() => toggleBarrio(b)}
                  className="text-xs"
                >
                  {b}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {activeFiltersCount > 0 && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
              <X className="h-3 w-3" /> Limpiar ({activeFiltersCount})
            </Button>
          )}
        </div>

        <TabsContent value="mia" className="mt-0">
          {filteredMias.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={isLoading ? "Cargando…" : "Sin resultados en tu cartera"}
              description="Ajusta los filtros o contacta con tu administrador para que te asigne edificios."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredMias.map((r) => (
                <BuildingCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="todos" className="mt-0">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            Mostrando {filteredTodos.length} de {rows.length}
          </div>
          {filteredTodos.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={isLoading ? "Cargando catálogo…" : "Sin resultados"}
              description="Ajusta los filtros o vuelve a intentarlo."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredTodos.map((r) => (
                <BuildingCard key={r.id} r={r} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

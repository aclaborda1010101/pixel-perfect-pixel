import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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
  AppWindow,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ScorePill,
  scoreTier,
  tierBarClass,
  tierTextClass,
  buildingScoreFactors,
} from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import { BuildingChips, type Aviso } from "@/components/comercial/BuildingChips";
import { AlarmChips, countAlarmas } from "@/components/comercial/AlarmChips";
import { DocAlertBadge } from "@/components/buildings/DocAlertBadge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Row = {
  id: string;
  direccion: string;
  ciudad: string | null;
  barrio: string | null;
  distrito: string | null;
  score: number;
  es_estrella: boolean;
  n_alarmas: number;
  num_viviendas: number | null;
  m2_total: number | null;
  owners_count: number | null;
  division_horizontal: boolean;
  ratio: number | null;
  raw: any;
  assigned: boolean;
  cartera_demo: boolean;
  avisos: Aviso[] | null;
  score_summary: string | null;
  confianza_media: number | null;
  has_analysis: boolean;
  ventanas_fachada_total?: number | null;
  ventanas_patios_total?: number | null;
  ventanas_total?: number | null;
  cluster_asignado?: string | null;
  segundas_escaleras?: boolean | null;
  plantas_levantables?: number | null;
  tiene_azotea_transitable?: boolean | null;
  esquina?: boolean | null;
  protegido_historicamente?: boolean | null;
  edificio_reformado?: boolean | null;
  gestion_profesional?: boolean | null;
};

const CLUSTER_LABELS: Record<string, { label: string; cls: string }> = {
  ultra_prime: { label: "Ultra Prime", cls: "bg-purple-500/15 text-purple-300 border-purple-500/30" },
  prime_value_add: { label: "Prime Value-Add", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  flex_living_core: { label: "Flex Living Core", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  outer_distressed: { label: "Outer Distressed", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  outer_distressed_selectivo: { label: "Outer selectivo", cls: "bg-amber-500/10 text-amber-300/80 border-amber-500/20" },
  baja_prioridad: { label: "Baja prioridad", cls: "bg-muted text-muted-foreground border-border-faint" },
};

const CLUSTER_KEYS = Object.keys(CLUSTER_LABELS);

export function ClusterChip({ cluster }: { cluster?: string | null }) {
  if (!cluster) return null;
  const c = CLUSTER_LABELS[cluster] ?? { label: cluster, cls: "bg-muted text-muted-foreground border-border-faint" };
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 whitespace-nowrap rounded-sm border px-1.5 text-[10px] font-medium uppercase tracking-eyebrow",
        c.cls,
      )}
    >
      {c.label}
    </Badge>
  );
}

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
          <div className="min-w-0 flex-1 space-y-2">
            <Eyebrow>{r.barrio ?? r.ciudad ?? "—"}</Eyebrow>
            <h3 className="truncate text-base font-medium leading-tight text-foreground">
              {r.direccion}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <ClusterChip cluster={r.cluster_asignado} />
              <AlarmChips avisos={r.raw?.avisos_inteligentes} esEstrella={r.es_estrella} max={3} />
              <DocAlertBadge building={{ score: r.score, metadatos: r.raw?.metadatos, catastro_ref: r.raw?.catastro_ref, refcatastral: r.raw?.refcatastral, iee_estado: (r as any).raw?.iee_estado ?? (r as any).iee_estado }} />
              {r.assigned && (
                <Badge
                  variant="gold"
                  className="h-5 whitespace-nowrap rounded-sm px-1.5 text-[10px] uppercase tracking-eyebrow"
                >
                  Tu cartera
                </Badge>
              )}
              {r.cartera_demo && (
                <Badge className="h-5 whitespace-nowrap rounded-sm border-0 bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 text-[10px] uppercase tracking-eyebrow text-white">
                  Marcado
                </Badge>
              )}
            </div>
          </div>
          {r.score_summary ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="shrink-0 cursor-help">
                    <ScorePill score={r.score} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="text-xs leading-relaxed">
                    {r.score_summary.split(".").slice(0, 2).join(".") + "."}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <div className="shrink-0">
              <ScorePill score={r.score} />
            </div>
          )}
        </div>

        <BuildingChips avisos={r.avisos} hasAnalysis={r.has_analysis} max={4} />

        <div className="grid grid-cols-4 gap-2 rounded-md border border-border-faint bg-surface-1/40 p-2 text-center">
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
          <div>
            <AppWindow className="mx-auto mb-0.5 h-3 w-3 text-muted-foreground" />
            <div className={cn(
              "font-mono text-sm tabular-nums",
              r.ventanas_total ? "text-gold" : "text-muted-foreground"
            )}>
              {r.ventanas_total ?? "—"}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
              ventanas total
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
  // Filtros avanzados
  const [ventanasMin, setVentanasMin] = useState<string>("");
  const [advSegundasEscaleras, setAdvSegundasEscaleras] = useState(false);
  const [advPlantasLevantables, setAdvPlantasLevantables] = useState(false);
  const [advAzotea, setAdvAzotea] = useState(false);
  const [advEsquina, setAdvEsquina] = useState(false);
  const [advSinProteccion, setAdvSinProteccion] = useState(false);
  const [advSinReforma, setAdvSinReforma] = useState(false);
  const [advSinGestionPro, setAdvSinGestionPro] = useState(false);
  const [advClusters, setAdvClusters] = useState<Set<string>>(new Set());
  const [advSoloEstrella, setAdvSoloEstrella] = useState(false);

  // --- Mi cartera: query ligera (~80 filas) que se carga siempre ---
  const { data: miaData, isLoading: loadingMia } = useQuery({
    queryKey: ["comercial:edificios:mia", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const [{ data: assignments }, { data: demoBldgs }] = await Promise.all([
        (supabase.from("building_assignments" as any) as any)
          .select("building_id")
          .eq("user_id", userId)
          .eq("status", "active"),
        (supabase.from("buildings" as any) as any)
          .select("id")
          .eq("cartera_demo_seed", true),
      ]);
      const ids = Array.from(new Set<string>([
        ...((assignments ?? []) as any[]).map((a: any) => a.building_id),
        ...((demoBldgs ?? []) as any[]).map((b: any) => b.id),
      ]));
      if (ids.length === 0) return { rows: [] as Row[] };
      const [scoresRes, bldgsRes, analysisRes] = await Promise.all([
        (supabase.from("v_building_score" as any) as any).select("*").in("id", ids),
        (supabase.from("buildings" as any) as any)
          .select("id, avisos_inteligentes, score_summary, confianza_media, cartera_demo_seed, cluster_asignado, cluster_motivo, score, cluster_score, es_estrella, score_breakdown, iee_estado")
          .in("id", ids),
        (supabase.from("building_analysis" as any) as any)
          .select(
            "building_id, ventanas_fachada_total, ventanas_patios_total, segundas_escaleras, plantas_levantables, tiene_azotea_transitable, esquina, protegido_historicamente, edificio_reformado, gestion_profesional",
          )
          .in("building_id", ids),
      ]);
      const assignedIds = new Set<string>(((assignments ?? []) as any[]).map((a: any) => a.building_id));
      const bldgsById = new Map<string, any>();
      const demoIds = new Set<string>();
      for (const b of (bldgsRes.data ?? []) as any[]) {
        bldgsById.set(b.id, b);
        if (b.cartera_demo_seed) demoIds.add(b.id);
      }
      const analysisMap = new Map<string, any>();
      for (const a of (analysisRes.data ?? []) as any[]) analysisMap.set(a.building_id, a);
      const rows: Row[] = ((scoresRes.data ?? []) as any[]).map((b: any) => {
        const m2 = b.m2_total != null ? Number(b.m2_total) : null;
        const viv = b.num_viviendas != null ? Number(b.num_viviendas) : null;
        const extra = bldgsById.get(b.id) ?? {};
        const avisos = Array.isArray(extra.avisos_inteligentes) ? (extra.avisos_inteligentes as Aviso[]) : null;
        const an = analysisMap.get(b.id) ?? {};
        return {
          id: b.id,
          direccion: b.direccion,
          ciudad: b.ciudad,
          barrio: b.barrio ?? null,
          distrito: b.distrito ?? null,
          score: Number(extra.cluster_score ?? extra.score ?? b.score ?? 0),
          es_estrella: !!extra.es_estrella,
          n_alarmas: countAlarmas(extra.avisos_inteligentes),
          num_viviendas: viv,
          m2_total: m2,
          owners_count: b.owners_count,
          division_horizontal: !!b.division_horizontal,
          ratio: m2 && viv ? m2 / viv : null,
          raw: { ...b, score: extra.score ?? b.score ?? null, score_breakdown: extra.score_breakdown ?? b.score_breakdown ?? null, avisos_inteligentes: extra.avisos_inteligentes ?? null, es_estrella: !!extra.es_estrella },
          assigned: assignedIds.has(b.id),
          cartera_demo: demoIds.has(b.id),
          avisos,
          score_summary: extra.score_summary ?? null,
          confianza_media: extra.confianza_media ?? null,
          has_analysis: !!b.has_ai_analysis,
          ventanas_fachada_total: an.ventanas_fachada_total ?? null,
          ventanas_patios_total: an.ventanas_patios_total ?? null,
          ventanas_total: ((an.ventanas_fachada_total ?? 0) + (an.ventanas_patios_total ?? 0)) || null,
          cluster_asignado: extra.cluster_asignado ?? null,
          segundas_escaleras: an.segundas_escaleras ?? null,
          plantas_levantables: an.plantas_levantables ?? null,
          tiene_azotea_transitable: an.tiene_azotea_transitable ?? null,
          esquina: an.esquina ?? null,
          protegido_historicamente: an.protegido_historicamente ?? null,
          edificio_reformado: an.edificio_reformado ?? null,
          gestion_profesional: an.gestion_profesional ?? null,
        };
      });
      return { rows };
    },
  });

  // --- Catálogo completo: lazy, sólo al activar tab "todos" ---
  const { data: todosData, isLoading: loadingTodos } = useQuery({
    queryKey: ["comercial:edificios:todos", userId],
    enabled: !!userId && tab === "todos",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // Paginación completa: Supabase limita a 1000 filas/request, así que
      // iteramos hasta agotar el catálogo. El coste extra es marginal porque
      // la query es lazy (enabled: tab==="todos") y cachea 5 min.
      const PAGE = 1000;
      const fetchPage = (from: number) =>
        (supabase.from("v_building_score" as any) as any)
          .select("*")
          .order("score", { ascending: false })
          .range(from, from + PAGE - 1);
      const { data: assignments } = await (supabase.from("building_assignments" as any) as any)
        .select("building_id")
        .eq("user_id", userId)
        .eq("status", "active");
      const scores: any[] = [];
      let from = 0;
      // Safety cap: 10 páginas (10k edificios) — más que suficiente.
      for (let i = 0; i < 10; i++) {
        const { data } = await fetchPage(from);
        const batch = (data ?? []) as any[];
        scores.push(...batch);
        if (batch.length < PAGE) break;
        from += PAGE;
      }
      // Fetch de columnas "extra" en buildings SOLO para los IDs que vamos a pintar.
      const scoreIds = scores.map((b: any) => b.id);
      const { data: demoBldgs } = scoreIds.length
        ? await (supabase.from("buildings" as any) as any)
            .select("id, avisos_inteligentes, score_summary, confianza_media, cartera_demo_seed, cluster_asignado, cluster_motivo, score, cluster_score, es_estrella, score_breakdown, iee_estado")
            .in("id", scoreIds)
        : { data: [] as any[] };
      const assignedIds = new Set<string>((assignments ?? []).map((a: any) => a.building_id));
      const bldgsById = new Map<string, any>();
      const demoIds = new Set<string>();
      for (const b of demoBldgs ?? []) {
        bldgsById.set(b.id, b);
        if (b.cartera_demo_seed) demoIds.add(b.id);
      }

      // Análisis IA: sólo para los edificios de la cartera (asignados + demo).
      // El catálogo completo no necesita esta info en la tarjeta y bajaba la página.
      const analysisMap = new Map<string, any>();
      const interestingIds = Array.from(new Set<string>([...assignedIds, ...demoIds]));
      if (interestingIds.length > 0) {
        const { data: aPage } = await (supabase.from("building_analysis" as any) as any)
          .select(
            "building_id, ventanas_fachada_total, ventanas_patios_total, segundas_escaleras, plantas_levantables, tiene_azotea_transitable, esquina, protegido_historicamente, edificio_reformado, gestion_profesional",
          )
          .in("building_id", interestingIds);
        for (const row of (aPage ?? []) as any[]) analysisMap.set(row.building_id, row);
      }

      const rows: Row[] = (scores ?? []).map((b: any) => {
        const m2 = b.m2_total != null ? Number(b.m2_total) : null;
        const viv = b.num_viviendas != null ? Number(b.num_viviendas) : null;
        const extra = bldgsById.get(b.id) ?? {};
        const avisos = Array.isArray(extra.avisos_inteligentes) ? (extra.avisos_inteligentes as Aviso[]) : null;
        const an = analysisMap.get(b.id) ?? {};
        return {
          id: b.id,
          direccion: b.direccion,
          ciudad: b.ciudad,
          barrio: b.barrio ?? null,
          distrito: b.distrito ?? null,
          score: Number(extra.cluster_score ?? extra.score ?? b.score ?? 0),
          es_estrella: !!extra.es_estrella,
          n_alarmas: countAlarmas(extra.avisos_inteligentes),
          num_viviendas: viv,
          m2_total: m2,
          owners_count: b.owners_count,
          division_horizontal: !!b.division_horizontal,
          ratio: m2 && viv ? m2 / viv : null,
          raw: { ...b, score: extra.score ?? b.score ?? null, score_breakdown: extra.score_breakdown ?? b.score_breakdown ?? null, avisos_inteligentes: extra.avisos_inteligentes ?? null, es_estrella: !!extra.es_estrella },
          assigned: assignedIds.has(b.id),
          cartera_demo: demoIds.has(b.id),
          avisos,
          score_summary: extra.score_summary ?? null,
          confianza_media: extra.confianza_media ?? null,
          has_analysis: !!b.has_ai_analysis,
          ventanas_fachada_total: an.ventanas_fachada_total ?? null,
          ventanas_patios_total: an.ventanas_patios_total ?? null,
          ventanas_total: ((an.ventanas_fachada_total ?? 0) + (an.ventanas_patios_total ?? 0)) || null,
          cluster_asignado: extra.cluster_asignado ?? null,
          segundas_escaleras: an.segundas_escaleras ?? null,
          plantas_levantables: an.plantas_levantables ?? null,
          tiene_azotea_transitable: an.tiene_azotea_transitable ?? null,
          esquina: an.esquina ?? null,
          protegido_historicamente: an.protegido_historicamente ?? null,
          edificio_reformado: an.edificio_reformado ?? null,
          gestion_profesional: an.gestion_profesional ?? null,
        };
      });
      return { rows };
    },
  });

  const miasRows: Row[] = miaData?.rows ?? [];
  const todosRows: Row[] = todosData?.rows ?? [];
  const rows: Row[] = tab === "todos" && todosRows.length > 0 ? todosRows : miasRows;
  const isLoading = loadingMia || (tab === "todos" && loadingTodos);
  const [batchBusy, setBatchBusy] = useState(false);

  const launchBatch = async (onlyMissing: boolean) => {
    if (!userId) return;
    setBatchBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("batch-process-cartera", {
        body: { user_id: userId, only_missing: onlyMissing, force: !onlyMissing },
      });
      if (error) throw error;
      const d = data as any;
      if (d?.status === "nothing_to_do") {
        toast.info("Todos los edificios ya tienen análisis. Usa 'Reprocesar todos' para forzar.");
      } else {
        toast.success(`Procesando ${d?.total ?? "?"} edificios en segundo plano. Refresca en unos minutos.`);
      }
    } catch (e: any) {
      toast.error("Error al lanzar batch: " + (e?.message ?? String(e)));
    } finally {
      setBatchBusy(false);
    }
  };

  const launchClusterRecompute = async () => {
    setBatchBusy(true);
    try {
      toast.info("Recalculando scoring por clusters de los 74 edificios… esto tardará 2-5 min.");
      const { data, error } = await supabase.functions.invoke("recompute-cluster-scoring", {
        body: { only_seed: true },
      });
      if (error) throw error;
      const d = data as any;
      toast.success(`Listo: ${d?.processed ?? 0} edificios recalculados. Refresca la página.`);
    } catch (e: any) {
      toast.error("Error al recalcular: " + (e?.message ?? String(e)));
    } finally {
      setBatchBusy(false);
    }
  };

  // "Mi cartera" = asignados al user actual OR cartera_demo_seed=true
  const mias = useMemo(
    () => miasRows.filter((r) => r.assigned || r.cartera_demo),
    [miasRows],
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
    (tab === "todos" ? rows : mias).forEach((r) => r.barrio && set.add(r.barrio));
    return Array.from(set).sort();
  }, [rows, mias, tab]);

  const apply = (list: Row[]) => {
    const s = q.trim().toLowerCase();
    const smin = scoreMin === "" ? -Infinity : Number(scoreMin);
    const vntMin = ventanasMin === "" ? -Infinity : Number(ventanasMin);

    let out = list.filter((r) => {
      if (s) {
        const hay =
          r.direccion?.toLowerCase().includes(s) ||
          (r.ciudad ?? "").toLowerCase().includes(s) ||
          (r.barrio ?? "").toLowerCase().includes(s);
        if (!hay) return false;
      }
      if (r.score < smin) return false;
      if (barrios.size > 0 && (!r.barrio || !barrios.has(r.barrio))) return false;
      if (vntMin > -Infinity && (r.ventanas_total ?? -1) < vntMin) return false;
      if (advSegundasEscaleras && !r.segundas_escaleras) return false;
      if (advPlantasLevantables && !((r.plantas_levantables ?? 0) > 0)) return false;
      if (advAzotea && !r.tiene_azotea_transitable) return false;
      if (advEsquina && !r.esquina) return false;
      if (advSinProteccion && r.protegido_historicamente) return false;
      if (advSinReforma && r.edificio_reformado) return false;
      if (advSinGestionPro && r.gestion_profesional) return false;
      if (advClusters.size > 0 && (!r.cluster_asignado || !advClusters.has(r.cluster_asignado))) return false;
      if (advSoloEstrella && !r.es_estrella) return false;
      return true;
    });

    const cmp = (a: Row, b: Row) => {
      // El criterio de orden elegido manda. La estrella NO altera el orden:
      // es un flag visual y un filtro (ver "Solo edificios estrella"). Como
      // desempate al final, si el criterio principal empata, mostramos antes
      // los estrella y luego los que tienen más alarmas.
      switch (sort) {
        case "score_asc":
          if (a.score !== b.score) return a.score - b.score;
          break;
        case "viviendas_desc":
          if ((b.num_viviendas ?? -1) !== (a.num_viviendas ?? -1)) return (b.num_viviendas ?? -1) - (a.num_viviendas ?? -1);
          break;
        case "m2_desc":
          if ((Number(b.m2_total) || -1) !== (Number(a.m2_total) || -1)) return (Number(b.m2_total) || -1) - (Number(a.m2_total) || -1);
          break;
        case "ratio_desc":
          if ((b.ratio ?? -1) !== (a.ratio ?? -1)) return (b.ratio ?? -1) - (a.ratio ?? -1);
          break;
        case "owners_desc":
          if ((b.owners_count ?? -1) !== (a.owners_count ?? -1)) return (b.owners_count ?? -1) - (a.owners_count ?? -1);
          break;
        case "score_desc":
        default:
          if (a.score !== b.score) return b.score - a.score;
          break;
      }
      // Desempate: estrella > más alarmas
      if (a.es_estrella !== b.es_estrella) return a.es_estrella ? -1 : 1;
      if (a.n_alarmas !== b.n_alarmas) return b.n_alarmas - a.n_alarmas;
      return 0;
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
    setBarrios(new Set());
    setVentanasMin("");
    setAdvSegundasEscaleras(false);
    setAdvPlantasLevantables(false);
    setAdvAzotea(false);
    setAdvEsquina(false);
    setAdvSinProteccion(false);
    setAdvSinReforma(false);
    setAdvSinGestionPro(false);
    setAdvClusters(new Set());
    setAdvSoloEstrella(false);
  };

  const advancedCount =
    (ventanasMin !== "" ? 1 : 0) +
    (advSegundasEscaleras ? 1 : 0) +
    (advPlantasLevantables ? 1 : 0) +
    (advAzotea ? 1 : 0) +
    (advEsquina ? 1 : 0) +
    (advSinProteccion ? 1 : 0) +
    (advSinReforma ? 1 : 0) +
    (advSinGestionPro ? 1 : 0) +
    (advClusters.size > 0 ? 1 : 0) +
    (advSoloEstrella ? 1 : 0);
  const activeFiltersCount =
    (scoreMin !== "" ? 1 : 0) +
    (barrios.size > 0 ? 1 : 0) +
    advancedCount;

  const filteredMias = apply(visibleMias);
  const filteredTodos = apply(rows);

  const [showNewBuilding, setShowNewBuilding] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Edificios"
        title="Cartera y catálogo"
        subtitle={`${mias.length} en tu cartera${todosRows.length ? ` · ${todosRows.length} edificios totales` : ""}`}
        actions={
          <div className="flex gap-2">
          <Button
            onClick={() => setShowNewBuilding(true)}
            variant="gold"
            size="sm"
          >
            <Plus className="h-3 w-3" />
            Dar de alta nuevo edificio
          </Button>
          <Button
            onClick={launchClusterRecompute}
            disabled={batchBusy}
            variant="default"
            size="sm"
          >
            {batchBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Recalcular clusters (74)
          </Button>
          <Button
            onClick={() => launchBatch(true)}
            disabled={batchBusy || !userId}
            variant="gold"
            size="sm"
          >
            {batchBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Procesar pendientes ({mias.filter(m => !m.has_analysis).length})
          </Button>
          <Button
            onClick={() => launchBatch(false)}
            disabled={batchBusy || !userId}
            variant="outline"
            size="sm"
          >
            Reprocesar todos los {mias.length}
          </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="mia">Mi cartera ({mias.length})</TabsTrigger>
            <TabsTrigger value="todos">
              Todos los edificios{todosRows.length ? ` (${todosRows.length})` : ""}
            </TabsTrigger>
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
              Score mín
            </span>
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="0"
              value={scoreMin}
              onChange={(e) => setScoreMin(e.target.value)}
              className="h-8 w-16 text-xs"
            />
          </div>

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

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <SlidersHorizontal className="h-3 w-3" />
                Filtros avanzados
                {advancedCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {advancedCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 space-y-3" align="end">
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  Cluster de inversión
                </Label>
                <div className="flex flex-wrap gap-1">
                  {CLUSTER_KEYS.map((k) => {
                    const meta = CLUSTER_LABELS[k];
                    const active = advClusters.has(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() =>
                          setAdvClusters((prev) => {
                            const n = new Set(prev);
                            n.has(k) ? n.delete(k) : n.add(k);
                            return n;
                          })
                        }
                        className={cn(
                          "rounded-sm border px-2 py-1 text-[10px] uppercase tracking-eyebrow transition-colors",
                          active
                            ? meta.cls
                            : "border-border-faint bg-transparent text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="border-t border-border-faint" />
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  Ventanas totales (mínimo)
                </Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="ej. 50"
                  value={ventanasMin}
                  onChange={(e) => setVentanasMin(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-2 border-t border-border-faint pt-3">
                <Label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  Potencial estructural
                </Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="star"
                    checked={advSoloEstrella}
                    onCheckedChange={(c) => setAdvSoloEstrella(!!c)}
                  />
                  <Label htmlFor="star" className="cursor-pointer text-xs font-normal">
                    ⭐ Solo edificios estrella
                  </Label>
                </div>
                {[
                  { id: "esc", v: advSegundasEscaleras, s: setAdvSegundasEscaleras, l: "Tiene segundas escaleras" },
                  { id: "alt", v: advPlantasLevantables, s: setAdvPlantasLevantables, l: "Puede aumentar altura (plantas levantables)" },
                  { id: "azo", v: advAzotea, s: setAdvAzotea, l: "Azotea transitable" },
                  { id: "esq", v: advEsquina, s: setAdvEsquina, l: "Edificio en esquina" },
                ].map((o) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <Checkbox id={o.id} checked={o.v} onCheckedChange={(c) => o.s(!!c)} />
                    <Label htmlFor={o.id} className="cursor-pointer text-xs font-normal">{o.l}</Label>
                  </div>
                ))}
              </div>
              <div className="space-y-2 border-t border-border-faint pt-3">
                <Label className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                  Excluir penalizaciones
                </Label>
                {[
                  { id: "prot", v: advSinProteccion, s: setAdvSinProteccion, l: "Sin protección histórica" },
                  { id: "ref", v: advSinReforma, s: setAdvSinReforma, l: "Sin reforma reciente" },
                  { id: "ges", v: advSinGestionPro, s: setAdvSinGestionPro, l: "Sin gestión profesional" },
                ].map((o) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <Checkbox id={o.id} checked={o.v} onCheckedChange={(c) => o.s(!!c)} />
                    <Label htmlFor={o.id} className="cursor-pointer text-xs font-normal">{o.l}</Label>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

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
      <NewBuildingDialog open={showNewBuilding} onOpenChange={setShowNewBuilding} />
    </div>
  );
}

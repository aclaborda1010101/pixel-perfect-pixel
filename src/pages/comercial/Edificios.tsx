import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
  score_activo: number | null;
  score_propietarios: number | null;
  score_total: number | null;
  score_propietarios_breakdown: any | null;
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
  comercial: string | null;
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

function BuildingCard({ r, showActivo }: { r: Row; showActivo?: boolean }) {
  const mode: "total" | "activo" = showActivo ? "activo" : "total";
  const displayScore = getDisplayScore(
    { score_total: r.score_total, score_activo: r.score_activo, score: r.score },
    mode,
  );
  const tier = scoreTier(displayScore);
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
                    <ScorePill score={displayScore} mode={mode} />
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
              <ScorePill score={displayScore} mode={mode} />
            </div>
          )}
        </div>

        <BuildingChips avisos={r.avisos} hasAnalysis={r.has_analysis} max={4} />

        {/* Chip fino con las dos componentes del score total */}
        {(r.score_activo != null || r.score_propietarios != null) && (
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            <span>Activo <span className="tabular-nums text-foreground">{r.score_activo != null ? Math.round(Number(r.score_activo)) : "—"}</span></span>
            <span>·</span>
            <span>Propietarios <span className={cn("tabular-nums", (r.score_propietarios ?? 50) >= 60 ? "text-emerald-400" : (r.score_propietarios ?? 50) < 35 ? "text-destructive" : "text-foreground")}>{r.score_propietarios != null ? Math.round(Number(r.score_propietarios)) : "—"}</span></span>
            <span>·</span>
            <span>Total <span className="tabular-nums text-foreground">{r.score_total != null ? Math.round(Number(r.score_total)) : Math.round(r.score)}</span></span>
          </div>
        )}

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
  const [tab, setTab] = useState<"todos" | "jesus" | "david">("todos");
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
  // Toggle "Sin propietarios": muestra el score físico puro (score_activo).
  // Por defecto OFF → usamos score_total (mezcla activo × propietarios).
  const [viewActivo, setViewActivo] = useState<boolean>(() =>
    new URLSearchParams(window.location.search).get("view") === "activo",
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (viewActivo) url.searchParams.set("view", "activo");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", url.toString());
  }, [viewActivo]);

  // Windowing del catálogo "Todos": pintamos por lotes para que el DOM no
  // se atragante con >1000 tarjetas de golpe.
  const TODOS_PAGE = 60;
  const [shownTodos, setShownTodos] = useState(TODOS_PAGE);

  // Auto-selección de la pestaña según el comercial logueado.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
      const name = String((data as any)?.full_name ?? (data as any)?.email ?? "").toLowerCase();
      if (name.includes("jes")) setTab("jesus");
      else if (name.includes("david") || name.includes("casero")) setTab("david");
    })();
  }, [userId]);

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
          .select("id, avisos_inteligentes, score_summary, confianza_media, cartera_demo_seed, cluster_asignado, cluster_motivo, score, score_activo, score_propietarios, score_total, score_propietarios_breakdown, cluster_score, es_estrella, score_breakdown, iee_estado, comercial")
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
          score_activo: extra.score_activo ?? null,
          score_propietarios: extra.score_propietarios ?? null,
          score_total: extra.score_total ?? extra.score ?? null,
          score_propietarios_breakdown: extra.score_propietarios_breakdown ?? null,
          assigned: assignedIds.has(b.id),
          cartera_demo: demoIds.has(b.id),
          comercial: extra.comercial ?? null,
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

  // --- Catálogo completo (cacheado 10 min) ---
  const todosQueryKey = ["comercial:edificios:todos", userId] as const;
  const todosQueryFn = async () => {
      // Slim columns: seleccionar `*` sobre `v_building_score` incluía los
      // jsonb pesados `md` y `score_breakdown`, y con `order=score.desc`
      // (columna calculada) PostgREST cancelaba con statement_timeout (57014)
      // → la UI caía silenciosamente a la cartera de 77. Pedimos solo las
      // columnas que pinta la tarjeta y ordenamos por `id` (índice); el
      // orden real por score lo aplica el cliente con `apply()`.
      const V_COLS =
        "id,direccion,ciudad,division_horizontal,numero_propietarios,viviendas_unidades,owners_count,m2_total,num_viviendas,has_ai_analysis,ventanas_fachada_total,esquina,segundas_escaleras,protegido_historicamente,plantas_levantables,confidence,score";
      const B_COLS =
        "id,avisos_inteligentes,score_summary,confianza_media,cartera_demo_seed,cluster_asignado,cluster_motivo,score,score_activo,score_propietarios,score_total,score_propietarios_breakdown,cluster_score,es_estrella,score_breakdown,iee_estado,comercial";
      // 200 filas cabe holgadamente dentro del statement_timeout de `authenticated`
      // (8s) y también en el de `anon` (3s). Con Promise.all lanzamos todas las
      // páginas restantes en paralelo, así el catálogo entero (~1.156) se sirve
      // en el tiempo de la petición más lenta, no en suma secuencial.
      const PAGE = 200;

      const withRetry = async <T,>(fn: () => Promise<{ data: T[] | null; error: any }>, label: string) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fn();
          if (!res.error) return (res.data ?? []) as T[];
          if (attempt === 1) {
            const err = new Error(`[${label}] ${res.error?.message ?? "unknown"}`);
            (err as any).cause = res.error;
            throw err;
          }
          await new Promise((r) => setTimeout(r, 400));
        }
        return [] as T[];
      };

      const fetchViewPage = (from: number) =>
        withRetry(
          () =>
            (supabase.from("v_building_score" as any) as any)
              .select(V_COLS)
              .order("id")
              .range(from, from + PAGE - 1),
          `v_building_score ${from}-${from + PAGE - 1}`,
        );
      const fetchBldgPage = (from: number) =>
        withRetry(
          () =>
            (supabase.from("buildings" as any) as any)
              .select(B_COLS)
              .order("id")
              .range(from, from + PAGE - 1),
          `buildings ${from}-${from + PAGE - 1}`,
        );

      // Descubrimos el total con la primera página y lanzamos el resto en paralelo.
      const [firstView, firstBldg, assignmentsRes] = await Promise.all([
        fetchViewPage(0),
        fetchBldgPage(0),
        (supabase.from("building_assignments" as any) as any)
          .select("building_id")
          .eq("user_id", userId)
          .eq("status", "active"),
      ]);
      const scores: any[] = [...firstView];
      const demoBldgs: any[] = [...firstBldg];
      const restViewPromises: Promise<any[]>[] = [];
      const restBldgPromises: Promise<any[]>[] = [];
      // Estimación de páginas restantes: con 200 filas/página y un catálogo de
      // ~1.200 edificios necesitamos ~6 páginas. Reservamos hasta 15 para
      // márgenes de crecimiento sin saturar PostgREST.
      const MAX_EXTRA_PAGES = 15;
      if (firstView.length === PAGE) {
        for (let i = 1; i <= MAX_EXTRA_PAGES; i++) restViewPromises.push(fetchViewPage(i * PAGE));
      }
      if (firstBldg.length === PAGE) {
        for (let i = 1; i <= MAX_EXTRA_PAGES; i++) restBldgPromises.push(fetchBldgPage(i * PAGE));
      }
      const [restViews, restBldgs] = await Promise.all([
        Promise.all(restViewPromises),
        Promise.all(restBldgPromises),
      ]);
      for (const batch of restViews) {
        scores.push(...batch);
        if (batch.length < PAGE) break;
      }
      for (const batch of restBldgs) {
        demoBldgs.push(...batch);
        if (batch.length < PAGE) break;
      }
      const assignments = assignmentsRes.data;
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
          score_activo: extra.score_activo ?? null,
          score_propietarios: extra.score_propietarios ?? null,
          score_total: extra.score_total ?? extra.score ?? null,
          score_propietarios_breakdown: extra.score_propietarios_breakdown ?? null,
          assigned: assignedIds.has(b.id),
          cartera_demo: demoIds.has(b.id),
          comercial: (extra as any).comercial ?? null,
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
    };
  const {
    data: todosData,
    isLoading: loadingTodos,
    error: todosError,
    refetch: refetchTodos,
    isFetching: fetchingTodos,
  } = useQuery({
    queryKey: todosQueryKey,
    enabled: !!userId,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: todosQueryFn,
    retry: 1,
  });

  const miasRows: Row[] = miaData?.rows ?? [];
  const todosRows: Row[] = todosData?.rows ?? [];
  // Solo caemos a "mias" cuando NO hay error del catálogo. Si el catálogo
  // falló, mostramos un aviso claro y NO ocultamos el problema tras los 77.
  const rows: Row[] = todosRows.length > 0 ? todosRows : (todosError ? [] : miasRows);
  const isLoading = loadingMia || loadingTodos;

  // Si la URL trae ?filter=cartera_demo aplicamos solo demo y forzamos sort score desc
  const carteraDemoOnly = urlFilter === "cartera_demo";

  useEffect(() => {
    if (carteraDemoOnly) {
      setTab("todos");
      setSort("score_desc");
    }
  }, [carteraDemoOnly]);

  // Filas por pestaña (comercial). "Todos" = catálogo completo.
  const rowsByTab = useMemo(() => {
    if (tab === "jesus") return rows.filter((r) => (r.comercial ?? "").toLowerCase().includes("jes"));
    if (tab === "david") return rows.filter((r) => (r.comercial ?? "").toLowerCase().includes("david") || (r.comercial ?? "").toLowerCase().includes("casero"));
    return carteraDemoOnly ? rows.filter((r) => r.cartera_demo) : rows;
  }, [rows, tab, carteraDemoOnly]);
  const countJesus = useMemo(() => rows.filter((r) => (r.comercial ?? "").toLowerCase().includes("jes")).length, [rows]);
  const countDavid = useMemo(() => rows.filter((r) => (r.comercial ?? "").toLowerCase().includes("david") || (r.comercial ?? "").toLowerCase().includes("casero")).length, [rows]);

  const allBarrios = useMemo(() => {
    const set = new Set<string>();
    rowsByTab.forEach((r) => r.barrio && set.add(r.barrio));
    return Array.from(set).sort();
  }, [rowsByTab]);

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
      // Si el toggle "Sin propietarios" está activo, ordenamos por score_activo.
      const aScore = viewActivo && a.score_activo != null ? Number(a.score_activo) : a.score;
      const bScore = viewActivo && b.score_activo != null ? Number(b.score_activo) : b.score;
      // El criterio de orden elegido manda. La estrella NO altera el orden:
      // es un flag visual y un filtro (ver "Solo edificios estrella"). Como
      // desempate al final, si el criterio principal empata, mostramos antes
      // los estrella y luego los que tienen más alarmas.
      switch (sort) {
        case "score_asc":
          if (aScore !== bScore) return aScore - bScore;
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
          if (aScore !== bScore) return bScore - aScore;
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

  const filteredTodos = apply(rowsByTab);

  // Al cambiar filtros/orden/tab, volvemos a la primera "página" de render.
  useEffect(() => {
    setShownTodos(TODOS_PAGE);
  }, [tab, q, sort, scoreMin, barrios, ventanasMin, advSegundasEscaleras,
      advPlantasLevantables, advAzotea, advEsquina, advSinProteccion,
      advSinReforma, advSinGestionPro, advClusters, advSoloEstrella]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Scoring total"
        title="Edificios · Scoring total"
        subtitle={`${countJesus} Jesús · ${countDavid} David${todosRows.length ? ` · ${todosRows.length} totales` : ""}`}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="todos">
              Todos los edificios{todosRows.length ? ` (${todosRows.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="jesus">Jesús ({countJesus})</TabsTrigger>
            <TabsTrigger value="david">David ({countDavid})</TabsTrigger>
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
          <div className="ml-auto flex items-center gap-2">
            <Checkbox
              id="toggle-view-activo"
              checked={viewActivo}
              onCheckedChange={(c) => setViewActivo(!!c)}
            />
            <Label htmlFor="toggle-view-activo" className="cursor-pointer text-xs font-normal">
              Sin propietarios
              <span className="ml-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                (score físico)
              </span>
            </Label>
          </div>
        </div>

        <TabsContent value={tab} className="mt-0">
          {todosError && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <div>
                <strong>No se pudo cargar el catálogo completo.</strong>{" "}
                <span className="opacity-80">
                  {(todosError as Error)?.message?.slice(0, 200) ?? "Error desconocido"}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchTodos()} disabled={fetchingTodos}>
                {fetchingTodos ? "Reintentando…" : "Reintentar"}
              </Button>
            </div>
          )}
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            Mostrando {filteredTodos.length} de {rowsByTab.length}
          </div>
          {filteredTodos.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={isLoading ? "Cargando catálogo…" : "Sin resultados"}
              description="Ajusta los filtros o vuelve a intentarlo."
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredTodos.slice(0, shownTodos).map((r) => (
                  <BuildingCard key={r.id} r={r} showActivo={viewActivo} />
                ))}
              </div>
              {shownTodos < filteredTodos.length && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShownTodos((n) => n + TODOS_PAGE)}
                  >
                    Cargar más ({Math.min(TODOS_PAGE, filteredTodos.length - shownTodos)} de {filteredTodos.length - shownTodos} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { OwnerStarIcon, RevistaIcon } from "@/components/comercial/PriorityIcons";
import { Link, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOwnersCount } from "@/hooks/useOwnersCount";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  Phone,
  ArrowUpDown,
  Home,
  Ruler,
  Calendar,
  ShieldAlert,
  Store,
  Briefcase,
  ShieldCheck,
  Percent,
  Building2,
  User,
  Star,
} from "lucide-react";
import {
  ScorePill,
  scoreTier,
  tierBarClass,
} from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import { ScoringResumen } from "@/components/comercial/ScoringResumen";
import { DerechoTags, InfluenciadorTag, AYUDA_DERECHOS, grupoDerecho, type GrupoDerecho } from "@/components/comercial/DerechoTags";
import { PgoumBlock } from "@/components/comercial/PgoumBlock";
import { DocAlertBadge } from "@/components/buildings/DocAlertBadge";
import { NotaSimpleBadge } from "@/components/buildings/NotaSimpleBadge";
import { AlarmChips } from "@/components/comercial/AlarmChips";
import { TitularidadRegistral } from "@/components/comercial/TitularidadRegistral";
import { Switch } from "@/components/ui/switch";
import { InterlocutorFlag } from "@/components/buildings/InterlocutorFlag";
import { InterlocutorCard } from "@/components/buildings/InterlocutorCard";
import { HacerInterlocutorButton } from "@/components/buildings/HacerInterlocutorButton";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { SituacionEdificioCard } from "@/components/buildings/SituacionEdificioCard";
import { situacionLabel } from "@/lib/situacionComercial";
import { Lock as LockIcon } from "lucide-react";
import { BloqueoContactoBadge, ExcepcionContactoButton } from "@/components/buildings/ContactoBloqueado";
import { contactoBloqueado, TEXTO_CONTACTO_BLOQUEADO } from "@/lib/bloqueoContacto";
import { Label } from "@/components/ui/label";

type SortKey = "score" | "pct" | "last" | "estado";

function ownerEstado(o: any): {
  label: string;
  variant: "default" | "outline" | "destructive" | "info" | "gold" | "warning" | "success";
} {
  const interes = (o.metadatos?.interes ?? "").toString().toLowerCase();
  if ((o.contactos_previos ?? 0) === 0) return { label: "Sin contactar", variant: "destructive" };
  if (interes.includes("alto") || interes.includes("interes")) return { label: "Interesado", variant: "success" };
  if (interes.includes("dud")) return { label: "Dudoso", variant: "warning" };
  if (interes.includes("no")) return { label: "No interesa", variant: "outline" };
  return { label: "Contactado", variant: "info" };
}

function SucesionBlock({ s }: { s: any }) {
  const label =
    s.estado_sucesion === "herencia_abierta" ? "Herencia abierta" :
    s.estado_sucesion === "sospecha" ? "Sospecha de fallecimiento" :
    "Envejecimiento alto";
  const tone =
    s.estado_sucesion === "herencia_abierta" ? "border-destructive/40 bg-destructive/10 text-destructive" :
    s.estado_sucesion === "sospecha" ? "border-warning/40 bg-warning-soft/40 text-warning" :
    "border-amber-500/40 bg-amber-500/10 text-amber-600";
  return (
    <Card>
      <CardHeader>
        <Eyebrow>Sucesión</Eyebrow>
        <CardTitle className="flex items-center gap-2">
          <span className={cn("rounded-[3px] border px-2 py-0.5 text-xs font-mono uppercase tracking-eyebrow", tone)}>
            {label}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
        <Kpi label="Propietarios" value={s.n_propietarios} />
        <Kpi label="Fallecidos" value={s.n_fallecidos} tone={s.n_fallecidos > 0 ? "danger" : undefined} />
        <Kpi label="Probables" value={s.n_probables} tone={s.n_probables > 0 ? "warn" : undefined} />
        <Kpi label="Mayores 85" value={s.n_mayores_85} />
        <Kpi label="Mayores 90" value={s.n_mayores_90} />
        <Kpi label="Edad media" value={s.edad_media ?? "—"} />
        <div className="col-span-2 text-xs text-muted-foreground md:col-span-6">
          Cobertura del dato de edad: <span className="font-mono text-foreground">{s.pct_con_fecha}%</span>
          {s.estado_sucesion === "herencia_abierta" && (
            <> · Objetivo: localizar herederos legales (nota simple actualizada, empadronamiento).</>
          )}
          {s.estado_sucesion === "envejecimiento_alto" && (
            <> · Herencias previsibles a medio plazo: preparar seguimiento periódico.</>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Kpi({ label, value, tone }: { label: string; value: any; tone?: "danger" | "warn" }) {
  const c =
    tone === "danger" ? "text-destructive" :
    tone === "warn" ? "text-warning" :
    "text-foreground";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-lg tabular-nums", c)}>{value ?? 0}</div>
    </div>
  );
}

export default function ComercialEdificioDetalle() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { role } = useCurrentRole();
  const [sort, setSort] = useState<SortKey>("pct");
  const [vistaDerecho, setVistaDerecho] = useState<"todos" | GrupoDerecho>("propiedad");
  // Toggle "Sin propietarios". DEBE declararse antes de cualquier early return
  // para no romper el orden de hooks entre el render de "Cargando…" y el render
  // con datos.
  const [viewActivo, setViewActivo] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("view") === "activo"
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (viewActivo) url.searchParams.set("view", "activo");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", url.toString());
  }, [viewActivo]);

  // Legacy auto-task generation retired: opening a building no longer writes tasks.

  const { data, refetch } = useQuery({
    queryKey: ["comercial:edificio", id, user?.id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: b }, { data: score }, { data: owners }, { data: assign }, { data: analysis }, { data: sucesion }, { data: ownersExtra }] = await Promise.all([
        supabase.from("buildings").select("*, notas_simples(id)").eq("id", id!).maybeSingle(),
        (supabase.from("v_building_score" as any) as any).select("*").eq("id", id!).maybeSingle(),
        (supabase.from("v_owner_score" as any) as any).select("*").eq("building_id", id!),
        user
          ? (supabase.from("building_assignments" as any) as any)
              .select("id")
              .eq("user_id", user.id)
              .eq("building_id", id!)
              .eq("status", "active")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        (supabase.from("building_analysis" as any) as any)
          .select("*")
          .eq("building_id", id!)
          .maybeSingle(),
        (supabase.from("v_building_sucesion" as any) as any)
          .select("*")
          .eq("building_id", id!)
          .maybeSingle(),
        (supabase.from("building_owners") as any)
          .select("owner_id, cuota, owners:owner_id(nombre_display, estado_vital, edad_anios, metadatos)")
          .eq("building_id", id!),
      ]);
      const { data: companies } = await (supabase.from("building_companies" as any) as any)
        .select("*, companies:company_id(id, nombre, cif, metadatos)")
        .eq("building_id", id!);
      const { data: sinFicha } = await (supabase.from("v_building_titulares_sin_ficha" as any) as any)
        .select("n_sin_ficha, pct_sin_ficha")
        .eq("building_id", id!)
        .maybeSingle();
      // Backfill desde Catastro (authority cache) — año construcción y desglose por usos.
      let catastro: any = null;
      const rc14 = (b as any)?.refcatastral ? String((b as any).refcatastral).slice(0, 14) : null;
      if (rc14) {
        const { data: cac } = await (supabase.from("catastro_authority_cache" as any) as any)
          .select("ano_construccion, viviendas_total, locales_total, superficie_parcela_m2, usos")
          .eq("refcatastral_14", rc14)
          .maybeSingle();
        catastro = cac ?? null;
      }
      return {
        b: b as any,
        score: score as any,
        owners: (owners ?? []) as any[],
        assigned: !!assign,
        analysis: (analysis ?? null) as any,
        companies: (companies ?? []) as any[],
        catastro,
        sucesion: (sucesion ?? null) as any,
        sinFicha: (sinFicha ?? null) as any,
        ownersExtra: Object.fromEntries(
          ((ownersExtra ?? []) as any[]).map((r: any) => [r.owner_id, { ...(r.owners || {}), cuota: r.cuota }]),
        ),
        hasNotaSimple: Array.isArray((b as any)?.notas_simples) && (b as any).notas_simples.length > 0,
      };
    },
  });

  const b = data?.b;
  const s = data?.score ?? {};
  const assigned = data?.assigned;
  const analysis = data?.analysis;
  const companies = data?.companies ?? [];
  const catastro = (data as any)?.catastro ?? null;
  const sucesion = (data as any)?.sucesion ?? null;
  const ownersExtra: Record<string, any> = (data as any)?.ownersExtra ?? {};
  const { data: ownersCount } = useOwnersCount(b?.id);
  const puedeInterlocutor = role === "admin" || role === "sales_manager" || !!assigned;

  if (!data?.b) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando edificio…</div>;
  }
  // Ratio m²/vivienda: preferimos ratio_m2_viv (m² sólo vivienda) de
  // v_building_score; fallback a m²_totales/viviendas si no hubiera.
  const ratio =
    (s as any)?.ratio_m2_viv != null
      ? Number((s as any).ratio_m2_viv)
      : s?.m2_total && s?.num_viviendas
      ? Number(s.m2_total) / Number(s.num_viviendas)
      : null;
  const anioConstr =
    b?.metadatos?.anio_construccion ??
    b?.metadatos?.year_built ??
    b?.metadatos?.ano_construccion ??
    catastro?.ano_construccion ??
    null;

  const ownersAll = [...(data.owners ?? [])].sort((a, b) => {
    if (sort === "score") return Number(b.score ?? 0) - Number(a.score ?? 0);
    if (sort === "pct") {
      // DESC: mayor % primero; los que no tienen % conocido, al final.
      const av = a.pct_propiedad == null ? Number.NEGATIVE_INFINITY : Number(a.pct_propiedad);
      const bv = b.pct_propiedad == null ? Number.NEGATIVE_INFINITY : Number(b.pct_propiedad);
      return bv - av;
    }
    if (sort === "last") {
      const la = a.last_call_at ? new Date(a.last_call_at).getTime() : 0;
      const lb = b.last_call_at ? new Date(b.last_call_at).getTime() : 0;
      return lb - la;
    }
    return Number((a.contactos_previos ?? 0) === 0 ? 0 : 1) - Number((b.contactos_previos ?? 0) === 0 ? 0 : 1);
  });

  // Filtro de vista por lo que consta a nombre de cada titular en la nota.
  const conteoGrupos = { propiedad: 0, usufructo: 0, sin_derecho: 0 } as Record<GrupoDerecho, number>;
  for (const o of ownersAll) conteoGrupos[grupoDerecho(o)] += 1;
  const owners =
    vistaDerecho === "todos"
      ? ownersAll
      : ownersAll.filter((o) => grupoDerecho(o) === vistaDerecho);

  // Fuente única del panel: v_owner_score. Un propietario "tiene %" cuando
  // pct_propiedad viene informado y no está marcado como inválido.
  const pctKnown = (data.owners ?? []).filter(
    (o: any) => o.pct_propiedad != null && !o.pct_invalido,
  );
  const pctKnownCount = pctKnown.length;
  const pctUnknownCount = (data.owners ?? []).length - pctKnownCount;
  const sumPct = pctKnown.reduce((s: number, o: any) => s + Number(o.pct_propiedad), 0);
  const pctInconsistente =
    pctKnown.length > 0 && pctUnknownCount === 0 && (sumPct < 95 || sumPct > 105);

  // Suma de los porcentajes de propiedad de los propietarios mostrados.
  const sumaVisible = owners.reduce(
    (t: number, o: any) => t + (o.pct_propiedad != null && !o.pct_invalido ? Number(o.pct_propiedad) : 0),
    0,
  );

  // Fuente única de los porcentajes del edificio: CRM (HubSpot) o nota del Registro.
  const fuentePct: string = String((ownersAll[0] as any)?.pct_fuente_edificio ?? "nota");
  const titularesSinFicha = Number((data as any)?.sinFicha?.n_sin_ficha ?? 0);
  const pctSinFicha = Number((data as any)?.sinFicha?.pct_sin_ficha ?? 0);

  const mapsQuery = encodeURIComponent(`${b.direccion}, ${b.ciudad ?? "Madrid"}`);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <>
            <Link to="/comercial/edificios" className="hover:text-gold">
              Edificios
            </Link>{" "}
            · Detalle
          </>
        }
        title={b.direccion}
        subtitle={`${b.ciudad ?? ""} ${b.codigo_postal ?? ""}`}
        actions={
          <div className="flex gap-2">
            <AlarmChips avisos={(b as any)?.avisos_inteligentes} esEstrella={(b as any)?.es_estrella} max={3} />
            <DocAlertBadge building={{ score: s?.score ?? b?.score, metadatos: b?.metadatos, catastro_ref: b?.catastro_ref, refcatastral: (b as any)?.refcatastral, iee_estado: (b as any)?.iee_estado }} />
            <NotaSimpleBadge building={b} hasNota={(data as any)?.hasNotaSimple} />
            {assigned ? (
              <Badge variant="gold">Tu cartera</Badge>
            ) : null}
            <Badge variant="outline">{situacionLabel(b.estado)}</Badge>
            <Badge variant={b.division_horizontal ? "outline" : "gold"}>
              {b.division_horizontal ? "División horizontal" : "Sin DH"}
            </Badge>
          </div>
        }
      />

      <SyncHubspotBar
        buildingId={b.id}
        lastSyncedAt={(b as any)?.last_synced_at}
        onDone={() => refetch()}
      />

      {b.interlocutor_owner_id && (
        <InterlocutorFlag nombre={ownersExtra[b.interlocutor_owner_id]?.nombre_display ?? owners.find((o: any) => o.owner_id === b.interlocutor_owner_id)?.nombre ?? null} />
      )}

      {b.porcentajes_estado !== "verificado" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {b.porcentajes_estado === "sin_nota" || b.porcentajes_estado === "sin_propietarios"
            ? "Todavía no consta la nota del registro con los propietarios de este edificio: la primera acción es conseguirla."
            : "El reparto de propiedad está en revisión: los porcentajes que ves proceden de la nota pero no cuadran al 100 %. Puedes llamar igualmente, pero confírmalos con el propietario."}
        </div>
      )}

      {/* Resumen narrativo + scoring visual */}
      {/* Resumen del edificio: qué es y por qué es (o no) oportunidad */}
      <EdificioResumenCard b={b} s={s} analysis={analysis} anioConstr={anioConstr} ownersCount={ownersCount ?? b.numero_propietarios ?? s.owners_count ?? 0} catastro={catastro} />

      <div className="grid gap-3 md:grid-cols-2">
        <SituacionEdificioCard buildingId={b.id} situacion={b.estado} onChanged={() => refetch()} />
        <InterlocutorCard buildingId={b.id} onChanged={() => refetch()} />
      </div>

      {/* Scoring: score + doble tesis + contribuciones (sin narrativa larga) */}
      <div className="flex items-center gap-2 justify-end">
        <Label htmlFor="view-activo" className="text-xs text-muted-foreground">
          Sin propietarios
        </Label>
        <Switch id="view-activo" checked={viewActivo} onCheckedChange={setViewActivo} />
      </div>
      <ScoringResumen
        b={b}
        s={s}
        analysis={analysis}
        showActivo={viewActivo}
      />

      {/* PGOUM: protección + plantas levantables */}
      {id && <PgoumBlock buildingId={id} />}

      {sucesion && sucesion.estado_sucesion !== "sin_senales" && (
        <SucesionBlock s={sucesion} />
      )}

      {/* Sociedades propietarias */}
      {companies.length > 0 && (
        <Card>
          <CardHeader>
            <Eyebrow>Sociedades propietarias · {companies.length}</Eyebrow>
            <CardTitle>Estructura societaria del edificio</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border-faint">
              {companies.map((bc: any) => {
                const c = bc.companies || {};
                const rep = bc.metadatos?.representante || c.metadatos?.representante || null;
                const pct = bc.percentage ?? bc.metadatos?.pct_propiedad ?? null;
                return (
                  <li key={bc.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                        {c.nombre || "(sin nombre)"}
                        {c.cif && <span className="font-mono text-[11px] text-muted-foreground">{c.cif}</span>}
                      </div>
                      {rep && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          Representante: <span className="text-foreground">{rep}</span>
                        </div>
                      )}
                      {bc.role && (
                        <Badge variant="outline" className="mt-1">{String(bc.role)}</Badge>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {pct != null ? <span className="font-mono text-foreground">{Number(pct).toFixed(1)}%</span> : "—"}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Propietarios */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <Eyebrow>Propietarios · {ownersAll.length}</Eyebrow>
            <CardTitle>Sub-scoring y estado de contacto</CardTitle>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
              Con % de propiedad: {pctKnownCount} de {ownersAll.length}
            </div>
            <div
              className={cn(
                "mt-1 text-xs font-medium",
                sumaVisible >= 99.5 && sumaVisible <= 100.5 ? "text-emerald-600" : "text-amber-600",
              )}
              title="Suma de los porcentajes de propiedad de los propietarios que se están mostrando."
            >
              Suma de propiedad: {sumaVisible.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {fuentePct === "crm"
                ? "Porcentajes tomados de HubSpot (suman 100 %). No se mezclan con los de la nota del Registro."
                : "Porcentajes tomados de la nota del Registro."}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {([
                ["todos", `Todos (${ownersAll.length})`],
                ["propiedad", `Con propiedad (${conteoGrupos.propiedad})`],
                ["usufructo", `Solo usufructo (${conteoGrupos.usufructo})`],
                ["sin_derecho", `Influenciadores (${conteoGrupos.sin_derecho})`],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setVistaDerecho(k)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    vistaDerecho === k
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border-faint text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["score", "pct", "last", "estado"] as SortKey[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={sort === k ? "gold" : "outline"}
                onClick={() => setSort(k)}
              >
                <ArrowUpDown className="h-3 w-3" />
                {k === "score"
                  ? "Sub-score"
                  : k === "pct"
                  ? "% propiedad"
                  : k === "last"
                  ? "Última int."
                  : "Estado"}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {pctInconsistente && (
            <div className="mx-5 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Datos inconsistentes: la suma de % conocidos es {sumPct.toFixed(1)}% (fuera de 95–105%). Revisar nota simple.
            </div>
          )}
          {pctUnknownCount > 0 && (
            <div className="mx-5 mt-4 rounded-md border border-border-faint bg-surface-1 px-3 py-2 text-xs text-muted-foreground">
              {pctUnknownCount} de {(data.owners ?? []).length} propietarios sin % de propiedad conocido.
            </div>
          )}
          {titularesSinFicha > 0 && (
            <div className="mx-5 mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Faltan {titularesSinFicha} titulares que constan en la nota del Registro
              {pctSinFicha > 0
                ? ` (suman ${pctSinFicha.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%)`
                : ""}{" "}
              y todavía no tienen ficha. Están listados en el Orquestador como propuesta de alta.
            </div>
          )}
          <p className="mx-5 mt-3 text-[11px] leading-snug text-muted-foreground" title={AYUDA_DERECHOS}>
            {AYUDA_DERECHOS}.
          </p>
          <ul className="divide-y divide-border-faint">
            {owners.map((o) => {
              const e = ownerEstado(o);
              const sinContacto = (o.contactos_previos ?? 0) === 0;
              // Solo mostramos el % si viene normalizado (nunca % crudo engañoso)
              const pctKnown = o.pct_propiedad != null && !o.pct_invalido;
              const pct = pctKnown ? Number(o.pct_propiedad) : 0;
              const pctSinVerificar = pctKnown && o.pct_normalizado !== true;
              const soloUsufructo = !pctKnown && Number(o.pct_usufructo ?? 0) > 0;
              const sub = Number(o.score ?? 0);
              const subTier = scoreTier(sub);
              const cargas =
                o.metadatos?.cargas === true ||
                o.metadatos?.embargos === true ||
                (Array.isArray(o.metadatos?.cargas) && o.metadatos.cargas.length > 0);
              const edad = o.metadatos?.edad ?? o.metadatos?.edad_estimada ?? null;
              const bloqueado = contactoBloqueado(b.interlocutor_owner_id, o.owner_id);
              const esInterlocutor = b.interlocutor_owner_id === o.owner_id;

              return (
                <li
                  key={o.owner_id}
                  className={cn(
                    "px-5 py-4",
                    sinContacto && "bg-destructive/5",
                    bloqueado && "bg-surface-1/60 opacity-60",
                    esInterlocutor && "border-l-2 border-l-gold bg-gold/5",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-4">
                    <ScorePill score={sub} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {ownersExtra[o.owner_id]?.nombre_display || o.nombre || "—"}
                        </span>
                        {esInterlocutor && (
                          <Badge variant="gold" className="h-4 px-1.5 text-[9px]">Interlocutor activo</Badge>
                        )}
                        {pctKnown ? (
                          <span
                            className="shrink-0 rounded-[4px] border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gold"
                            title="% de propiedad (pleno + nuda)"
                          >
                            {pct.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
                          </span>
                        ) : soloUsufructo ? (
                          <span
                            className="shrink-0 rounded-[4px] border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-violet-500"
                            title="Solo usufructo — derecho de uso, no cuenta como propiedad"
                          >
                            Usufructo {Number(o.pct_usufructo).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                          </span>
                        ) : (
                          <span
                            className="shrink-0 rounded-[4px] border border-border-faint px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                            title="No consta derecho a su nombre en la nota"
                          >
                            sin derecho en la nota
                          </span>
                        )}
                        {ownersExtra[o.owner_id]?.estado_vital === "fallecido" && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">Fallecido</Badge>
                        )}
                        {ownersExtra[o.owner_id]?.estado_vital === "probable_fallecido" && (
                          <Badge variant="outline" className="h-4 border-warning/50 bg-warning-soft/40 px-1.5 text-[9px] text-warning">
                            Probable fallecido
                          </Badge>
                        )}
                        {ownersExtra[o.owner_id]?.metadatos?.prioridad_originacion && (
                          <OwnerStarIcon
                            title={`Propietario estrella — campaña junio 2026${ownersExtra[o.owner_id]?.metadatos?.revista_distrito ? ` · ${ownersExtra[o.owner_id]?.metadatos?.revista_distrito}` : ""}`}
                          />
                        )}
                        {ownersExtra[o.owner_id]?.metadatos?.revista_enviada === "true" && (
                          <RevistaIcon />
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {o.telefono ?? "sin teléfono"}
                        {(ownersExtra[o.owner_id]?.edad_anios ?? edad)
                          ? ` · ${ownersExtra[o.owner_id]?.edad_anios ?? edad} años`
                          : ""}
                      </div>
                      <div className="mt-1.5 grid max-w-md grid-cols-[80px_1fr_auto] items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                          % propiedad
                        </span>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
                          <div
                            className={cn(
                              "h-full",
                              pctKnown ? tierBarClass[scoreTier(Math.min(100, pct))] : "bg-muted",
                            )}
                            style={{ width: pctKnown ? `${Math.max(2, Math.min(100, pct))}%` : "0%" }}
                          />
                        </div>
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            pctKnown ? "text-gold" : "text-muted-foreground",
                          )}
                          title={o.pct_invalido ? `Valor inválido: ${o.pct_raw ?? ""}` : undefined}
                        >
                          {pctKnown ? `${pct.toFixed(1)}%` : soloUsufructo ? "solo usufructo" : "—"}
                        </span>
                        {pctKnown && o.pct_origen === "nota_simple" && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-emerald-500"
                            title={`% tomado de la nota simple · crudo "${o.pct_raw ?? ""}"`}
                          >
                            verificado NS
                          </span>
                        )}
                        {pctKnown && o.pct_origen === "crm_validado" && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-sky-500"
                            title="% tomado de HubSpot; el conjunto del edificio suma 100 %"
                          >
                            CRM validado
                          </span>
                        )}
                        {pctSinVerificar && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-amber-500"
                            title={`% sin verificar · crudo "${o.pct_raw ?? ""}"`}
                          >
                            % sin verificar
                          </span>
                        )}
                        {!pctKnown && !pctSinVerificar && o.pct_invalido && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-destructive"
                            title={`% inválido: "${o.pct_raw ?? ""}"`}
                          >
                            inválido
                          </span>
                        )}
                        {pctKnown && o.pct_origen && !['desconocido', 'nota_simple', 'en_revision', 'crm_validado'].includes(String(o.pct_origen)) && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground"
                            title={`Origen del %: ${o.pct_origen}`}
                          >
                            {o.pct_origen === 'hubspot' ? 'HS' : 'meta'}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {!soloUsufructo && <DerechoTags owner={o} className="mt-0" />}
                        <InfluenciadorTag owner={o} />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant={e.variant as any}>{e.label}</Badge>
                      <div className="flex items-center gap-1.5">
                        {cargas && (
                          <Badge variant="destructive" className="h-4 px-1.5 text-[9px]">
                            <ShieldAlert className="mr-0.5 h-2.5 w-2.5" /> Cargas
                          </Badge>
                        )}
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                          {o.contactos_previos ?? 0} contactos
                        </span>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                        {o.last_call_at
                          ? `Últ. ${new Date(o.last_call_at).toLocaleDateString("es")}`
                          : "Nunca contactado"}
                      </span>
                    </div>
                    {bloqueado ? (
                      <div className="flex flex-col items-end gap-1">
                        <BloqueoContactoBadge
                          nombreInterlocutor={
                            ownersExtra[b.interlocutor_owner_id]?.nombre_display ??
                            owners.find((x: any) => x.owner_id === b.interlocutor_owner_id)?.nombre ??
                            null
                          }
                        />
                        <Button size="sm" variant="outline" disabled title={TEXTO_CONTACTO_BLOQUEADO}>
                          <LockIcon className="h-3 w-3" /> Preparar
                        </Button>
                        <ExcepcionContactoButton buildingId={String(b.id)} ownerId={String(o.owner_id)} />
                        <HacerInterlocutorButton
                          buildingId={String(b.id)}
                          ownerId={String(o.owner_id)}
                          ownerNombre={ownersExtra[o.owner_id]?.nombre_display || o.nombre || null}
                          esActual={false}
                          hayInterlocutor={!!b.interlocutor_owner_id}
                          puedeGestionar={puedeInterlocutor}
                          onChanged={() => refetch()}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/comercial/preparar/${o.owner_id}`}>
                            <Phone className="h-3 w-3" /> Preparar
                          </Link>
                        </Button>
                        <HacerInterlocutorButton
                          buildingId={String(b.id)}
                          ownerId={String(o.owner_id)}
                          ownerNombre={ownersExtra[o.owner_id]?.nombre_display || o.nombre || null}
                          esActual={esInterlocutor}
                          hayInterlocutor={!!b.interlocutor_owner_id}
                          puedeGestionar={puedeInterlocutor}
                          onChanged={() => refetch()}
                        />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
            {owners.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted-foreground">
                {ownersAll.length === 0 ? "Sin propietarios registrados." : "Nadie en esta vista."}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* Titularidad registral (nota simple) — debajo de propietarios */}
      {id && <TitularidadRegistral buildingId={id} />}
    </div>
  );
}

function EdificioResumenCard({
  b, s, analysis, anioConstr, ownersCount, catastro,
}: { b: any; s: any; analysis: any; anioConstr: any; ownersCount: number; catastro?: any }) {
  const md = (b?.metadatos ?? {}) as Record<string, any>;
  const num = (v: any) => {
    const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const m2Total = num(s?.m2_total) || num(md.metros_cuadrados__exactos_) || num(md.metros_cuadrados__exactos____clonada_);
  let m2Viv = num(s?.m2_viviendas) || num(md.metros_cuadrados_viviendas) || num(md.metros_cuadrados_viviendas___clonada_);
  const m2Com = num(s?.m2_comercio) || num(s?.m2_comercio_x) || num(md.metros_cuadrados_comercio);
  const m2Ofi = num(s?.m2_oficina) || num(s?.m2_oficina_x) || num(md.metros_cuadrados_oficina) || num(md.metros_cuadrado_oficina);
  let numViv = num(s?.num_viviendas) || num(s?.viviendas_unidades) || num(md.viviendas__unidades_) || num(md.viviendas__unidades___clonada_);
  const pctTerciario = m2Total > 0 ? Math.round(((m2Com + m2Ofi) / m2Total) * 100) : null;
  // Backfill Catastro: si no hay m² viviendas y % terciario = 0 → m² total.
  if (m2Viv === 0 && m2Total > 0 && (pctTerciario === 0 || pctTerciario === null)) {
    m2Viv = m2Total;
  }
  // Backfill Catastro: si no hay nº viviendas usamos catastro_authority_cache.viviendas_total.
  if (numViv === 0 && catastro?.viviendas_total) {
    numViv = Number(catastro.viviendas_total) || 0;
  }
  const protegido = !!(analysis?.protegido_historicamente);
  const clusterMain = b?.cluster_asignado ?? null;
  const clusterSec = b?.cluster_secundario ?? null;

  // Resumen en 2-4 líneas (dinámico según datos)
  const partes: string[] = [];
  if (m2Total > 0) {
    const bits: string[] = [`${m2Total.toLocaleString()} m² construidos`];
    if (numViv > 0) bits.push(`${numViv} viviendas`);
    if (anioConstr) bits.push(`de ${anioConstr}`);
    partes.push(`Edificio de ${bits.join(", ")}.`);
  }
  if (m2Com > 0 || m2Ofi > 0) {
    const usos: string[] = [];
    if (m2Viv > 0) usos.push(`${m2Viv.toLocaleString()} m² residenciales`);
    if (m2Com > 0) usos.push(`${m2Com.toLocaleString()} m² comercio`);
    if (m2Ofi > 0) usos.push(`${m2Ofi.toLocaleString()} m² oficina`);
    partes.push(`Mix de usos: ${usos.join(" · ")}${pctTerciario != null ? ` (${pctTerciario}% terciario)` : ""}.`);
  }
  if (protegido) partes.push("Protección histórica: implica limitaciones de reforma y elevación.");
  if (ownersCount >= 3) {
    partes.push(`${ownersCount} copropietarios · buena palanca de proindiviso para consolidar bloque.`);
  } else if (ownersCount > 0) {
    partes.push(`${ownersCount} ${ownersCount === 1 ? "propietario" : "propietarios"} · negociación acotada.`);
  }

  const Kpi = ({ icon: Icon, label, value, tint }: { icon: any; label: string; value: React.ReactNode; tint?: string }) => (
    <div className="flex items-start gap-2 rounded-md border border-border-faint bg-surface-1/40 p-2.5">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 flex-shrink-0", tint ?? "text-gold")} />
      <div className="min-w-0">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">{label}</div>
        <div className="font-mono text-sm tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <Eyebrow><Building2 className="mr-1 inline h-3 w-3" /> Resumen del edificio</Eyebrow>
        <CardTitle className="flex items-center gap-2 text-base">
          Qué es y qué potencial tiene
          {clusterMain && (
            <Badge variant="gold" className="text-[10px]">{clusterMain}</Badge>
          )}
          {clusterSec && (
            <Badge variant="outline" className="text-[10px]">/ {clusterSec}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {partes.length > 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">{partes.join(" ")}</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi icon={Home} label="m² viviendas" value={m2Viv > 0 ? m2Viv.toLocaleString() : "—"} />
          <Kpi icon={Store} label="m² comercio" value={m2Com > 0 ? m2Com.toLocaleString() : "—"} />
          <Kpi icon={Briefcase} label="m² oficina" value={m2Ofi > 0 ? m2Ofi.toLocaleString() : "—"} />
          <Kpi icon={Ruler} label="Nº viviendas" value={numViv > 0 ? numViv : "—"} />
          <Kpi icon={Calendar} label="Año" value={anioConstr ?? "—"} />
          <Kpi
            icon={protegido ? ShieldAlert : ShieldCheck}
            tint={protegido ? "text-amber-400" : "text-emerald-400"}
            label="Protección"
            value={protegido ? "Sí" : "No"}
          />
          {pctTerciario != null && (
            <Kpi icon={Percent} label="% terciario" value={`${pctTerciario}%`} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

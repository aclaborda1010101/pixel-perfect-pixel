import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import {
  ScorePill,
  scoreTier,
  tierBarClass,
} from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import { BuildingTasksSection } from "@/components/comercial/BuildingTasksSection";
import { syncBuildingTasks } from "@/lib/buildingTasks";
import { ScoringResumen } from "@/components/comercial/ScoringResumen";
import { PgoumBlock } from "@/components/comercial/PgoumBlock";
import { DocAlertBadge } from "@/components/buildings/DocAlertBadge";
import { AlarmChips } from "@/components/comercial/AlarmChips";

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

export default function ComercialEdificioDetalle() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [sort, setSort] = useState<SortKey>("pct");

  useEffect(() => {
    if (id && user?.id) {
      syncBuildingTasks(id, user.id).catch(() => {});
    }
  }, [id, user?.id]);

  const { data } = useQuery({
    queryKey: ["comercial:edificio", id, user?.id],
    enabled: !!id,
    queryFn: async () => {
      const [{ data: b }, { data: score }, { data: owners }, { data: assign }, { data: analysis }] = await Promise.all([
        supabase.from("buildings").select("*").eq("id", id!).maybeSingle(),
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
      ]);
      const { data: companies } = await (supabase.from("building_companies" as any) as any)
        .select("*, companies:company_id(id, nombre, cif, metadatos)")
        .eq("building_id", id!);
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
      };
    },
  });

  const b = data?.b;
  const s = data?.score ?? {};
  const assigned = data?.assigned;
  const analysis = data?.analysis;
  const companies = data?.companies ?? [];
  const catastro = (data as any)?.catastro ?? null;
  const { data: ownersCount } = useOwnersCount(b?.id);

  if (!data?.b) {
    return <div className="p-8 text-sm text-muted-foreground">Cargando edificio…</div>;
  }
  const ratio =
    s?.m2_total && s?.num_viviendas ? Number(s.m2_total) / Number(s.num_viviendas) : null;
  const anioConstr =
    b?.metadatos?.anio_construccion ??
    b?.metadatos?.year_built ??
    b?.metadatos?.ano_construccion ??
    catastro?.ano_construccion ??
    null;

  const owners = [...(data.owners ?? [])].sort((a, b) => {
    if (sort === "score") return Number(b.score ?? 0) - Number(a.score ?? 0);
    if (sort === "pct") {
      // ASC: menor % primero (más fáciles de comprar / mayor palanca)
      // NULL al final (NULLS LAST)
      const av = a.pct_propiedad == null ? Number.POSITIVE_INFINITY : Number(a.pct_propiedad);
      const bv = b.pct_propiedad == null ? Number.POSITIVE_INFINITY : Number(b.pct_propiedad);
      return av - bv;
    }
    if (sort === "last") {
      const la = a.last_call_at ? new Date(a.last_call_at).getTime() : 0;
      const lb = b.last_call_at ? new Date(b.last_call_at).getTime() : 0;
      return lb - la;
    }
    return Number((a.contactos_previos ?? 0) === 0 ? 0 : 1) - Number((b.contactos_previos ?? 0) === 0 ? 0 : 1);
  });

  // Building-level pct validation (only meaningful when all owners have known pct)
  const pctKnown = (data.owners ?? []).filter((o: any) => o.pct_propiedad != null);
  const pctUnknownCount = (data.owners ?? []).length - pctKnown.length;
  const sumPct = pctKnown.reduce((s: number, o: any) => s + Number(o.pct_propiedad), 0);
  const pctInconsistente =
    pctKnown.length > 0 && pctUnknownCount === 0 && (sumPct < 95 || sumPct > 105);

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
            {assigned ? (
              <Badge variant="gold">Tu cartera</Badge>
            ) : null}
            <Badge variant={b.division_horizontal ? "outline" : "gold"}>
              {b.division_horizontal ? "División horizontal" : "Sin DH"}
            </Badge>
          </div>
        }
      />

      {/* Resumen narrativo + scoring visual */}
      {/* Resumen del edificio: qué es y por qué es (o no) oportunidad */}
      <EdificioResumenCard b={b} s={s} analysis={analysis} anioConstr={anioConstr} ownersCount={ownersCount ?? b.numero_propietarios ?? s.owners_count ?? 0} catastro={catastro} />

      {/* Scoring: score + doble tesis + contribuciones (sin narrativa larga) */}
      <ScoringResumen
        b={b}
        s={s}
        analysis={analysis}
        showActivo={new URLSearchParams(window.location.search).get("view") === "activo"}
      />

      {/* PGOUM: protección + plantas levantables */}
      {id && <PgoumBlock buildingId={id} />}

      {/* Tareas del edificio */}
      {user?.id && id && <BuildingTasksSection buildingId={id} userId={user.id} />}

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
            <Eyebrow>Propietarios · {owners.length}</Eyebrow>
            <CardTitle>Sub-scoring y estado de contacto</CardTitle>
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
          <ul className="divide-y divide-border-faint">
            {owners.map((o) => {
              const e = ownerEstado(o);
              const sinContacto = (o.contactos_previos ?? 0) === 0;
              // Solo mostramos el % si viene normalizado (nunca % crudo engañoso)
              const pctVerificado = o.pct_propiedad != null && o.pct_normalizado === true && !o.pct_invalido;
              const pctKnown = pctVerificado;
              const pct = pctKnown ? Number(o.pct_propiedad) : 0;
              const pctSinVerificar = o.pct_propiedad != null && !pctVerificado;
              const sub = Number(o.score ?? 0);
              const subTier = scoreTier(sub);
              const cargas =
                o.metadatos?.cargas === true ||
                o.metadatos?.embargos === true ||
                (Array.isArray(o.metadatos?.cargas) && o.metadatos.cargas.length > 0);
              const edad = o.metadatos?.edad ?? o.metadatos?.edad_estimada ?? null;

              return (
                <li key={o.owner_id} className={cn("px-5 py-4", sinContacto && "bg-destructive/5")}>
                  <div className="flex flex-wrap items-center gap-4">
                    <ScorePill score={sub} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {o.nombre ?? "—"}
                      </div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {o.telefono ?? "sin teléfono"}
                        {edad ? ` · ${edad} años` : ""}
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
                          {pctKnown ? `${pct.toFixed(1)}%` : "—"}
                        </span>
                        {pctKnown && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-emerald-500"
                            title={`% verificado · origen ${o.pct_origen ?? "?"} · crudo "${o.pct_raw ?? ""}"`}
                          >
                            verificado
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
                        {pctKnown && o.pct_origen && o.pct_origen !== 'desconocido' && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground"
                            title={`Origen del %: ${o.pct_origen}`}
                          >
                            {o.pct_origen === 'nota_simple' ? 'NS' : o.pct_origen === 'hubspot' ? 'HS' : 'meta'}
                          </span>
                        )}
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
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/comercial/preparar/${o.owner_id}`}>
                        <Phone className="h-3 w-3" /> Preparar
                      </Link>
                    </Button>
                  </div>
                </li>
              );
            })}
            {owners.length === 0 && (
              <li className="px-5 py-6 text-sm text-muted-foreground">Sin propietarios registrados.</li>
            )}
          </ul>
        </CardContent>
      </Card>
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

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
  MapPin,
  ArrowUpDown,
  Home,
  Ruler,
  Layers,
  Users,
  Calendar,
  Check,
  X,
  ShieldAlert,
  Store,
  Briefcase,
  Package,
  Car,
  Building,
  Hotel,
  Factory,
  Tag,
} from "lucide-react";
import {
  ScorePill,
  scoreTier,
  tierBarClass,
} from "@/components/comercial/scoring";
import { cn } from "@/lib/utils";
import { BuildingTasksSection } from "@/components/comercial/BuildingTasksSection";
import { syncBuildingTasks } from "@/lib/buildingTasks";
import { AnalisisIASection } from "@/components/comercial/AnalisisIASection";
import { CatastroDetalladoCard } from "@/components/comercial/CatastroDetalladoCard";
import { AnalisisPlanoCatastralCard } from "@/components/comercial/AnalisisPlanoCatastralCard";
import { ScoringResumen } from "@/components/comercial/ScoringResumen";
import { TeamFeedbackCard } from "@/components/comercial/TeamFeedbackCard";
import { VerificacionInlinePanel } from "@/components/comercial/VerificacionInlinePanel";
import { PgoumBlock } from "@/components/comercial/PgoumBlock";
import { DocAlertBadge } from "@/components/buildings/DocAlertBadge";
import { IeeBadge, IeeCard } from "@/components/buildings/IeeStatus";

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
      return {
        b: b as any,
        score: score as any,
        owners: (owners ?? []) as any[],
        assigned: !!assign,
        analysis: (analysis ?? null) as any,
        companies: (companies ?? []) as any[],
      };
    },
  });

  const b = data?.b;
  const s = data?.score ?? {};
  const assigned = data?.assigned;
  const analysis = data?.analysis;
  const companies = data?.companies ?? [];
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

  const CatastroItem = ({
    icon: Icon,
    label,
    value,
  }: {
    icon: any;
    label: string;
    value: React.ReactNode;
  }) => (
    <div className="flex items-start gap-3 rounded-md border border-border-faint bg-surface-1/40 p-3">
      <div className="rounded-md bg-surface-1 p-2 text-gold">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
          {label}
        </div>
        <div className="font-mono text-base tabular-nums text-foreground">{value}</div>
      </div>
    </div>
  );

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
            <DocAlertBadge building={{ score: s?.score ?? b?.score, metadatos: b?.metadatos, catastro_ref: b?.catastro_ref, refcatastral: (b as any)?.refcatastral, iee_estado: (b as any)?.iee_estado }} />
            <IeeBadge building={b as any} />
            {assigned ? (
              <Badge variant="gold">Tu cartera</Badge>
            ) : (
              <Badge variant="outline">Solo consulta</Badge>
            )}
            <Badge variant={b.division_horizontal ? "outline" : "gold"}>
              {b.division_horizontal ? "División horizontal" : "Sin DH"}
            </Badge>
          </div>
        }
      />

      {/* Resumen narrativo + scoring visual */}
      <ScoringResumen b={b} s={s} analysis={analysis} />

      <IeeCard buildingId={b.id} building={b as any} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Catastro */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <Eyebrow>Resumen scoring</Eyebrow>
            <CardTitle>Métricas que alimentan el score</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CatastroItem icon={Ruler} label="m² totales" value={s.m2_total ? Number(s.m2_total).toLocaleString() : "—"} />
              <CatastroItem icon={Ruler} label="m² viviendas" value={s.m2_viviendas != null ? Number(s.m2_viviendas).toLocaleString() : "—"} />
              <CatastroItem icon={Ruler} label="m² (rango)" value={s.m2_rango ?? "—"} />
              <CatastroItem icon={Home} label="Nº viviendas" value={s.num_viviendas ?? "—"} />
              <CatastroItem icon={Layers} label="Ratio m²/vivienda" value={ratio != null ? `${ratio.toFixed(1)} m²` : "—"} />
              <CatastroItem icon={Users} label="Nº propietarios" value={ownersCount ?? b.numero_propietarios ?? s.owners_count ?? 0} />
              <CatastroItem icon={Tag} label="Tipo oportunidad" value={s.tipo_oportunidad ?? "—"} />
              <CatastroItem
                icon={b.division_horizontal ? X : Check}
                label="División horizontal"
                value={
                  <span className={b.division_horizontal ? "text-red-400" : "text-emerald-400"}>
                    {b.division_horizontal ? "Sí" : "No"}
                  </span>
                }
              />
              <CatastroItem icon={Calendar} label="Año construcción" value={anioConstr ?? "—"} />
            </div>
            {b.catastro_ref && (
              <div className="rounded-md border border-border-faint p-3">
                <Eyebrow>Ref. catastral</Eyebrow>
                <div className="mt-1 font-mono text-xs text-foreground">{b.catastro_ref}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mapa */}
        <Card className="overflow-hidden">
          <CardHeader>
            <Eyebrow>
              <MapPin className="mr-1 inline h-3 w-3" /> Ubicación
            </Eyebrow>
            <CardTitle>{b.ciudad ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative h-[320px] w-full overflow-hidden">
              <iframe
                title="Mapa edificio"
                src={`https://www.google.com/maps?q=${mapsQuery}&output=embed`}
                className="h-full w-full border-0"
                style={{
                  filter:
                    "invert(0.92) hue-rotate(180deg) saturate(0.55) brightness(0.95) contrast(0.95)",
                }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 50% 50%, transparent 55%, hsl(var(--background) / 0.55) 100%)",
                  mixBlendMode: "multiply",
                }}
              />
              <a
                href={`https://www.google.com/maps?q=${mapsQuery}`}
                target="_blank"
                rel="noreferrer"
                className="absolute right-3 top-3 rounded-md border border-border-faint bg-surface-1/80 px-2 py-1 font-mono text-[10px] uppercase tracking-eyebrow text-gold backdrop-blur hover:bg-surface-1"
              >
                Abrir en Maps ↗
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Datos catastrales completos (OVC Consulta_DNPRC) */}
      {id && <CatastroDetalladoCard buildingId={id} refCatastral={b.refcatastral ?? b.catastro_ref} />}

      {/* Análisis del plano catastral (anotaciones IA) */}
      {id && <AnalisisPlanoCatastralCard buildingId={id} />}

      {/* Distribución del inmueble */}
      <DistribucionInmueble s={s} />

      {/* Análisis IA (Catastro + Google + Gemini) */}
      {id && <AnalisisIASection buildingId={id} />}

      {/* PGOUM: protección + plantas levantables */}
      {id && <PgoumBlock buildingId={id} />}

      {/* Tareas del edificio */}
      {user?.id && id && <BuildingTasksSection buildingId={id} userId={user.id} />}

      {/* Validación humana inline (alimenta qa_ground_truth) */}
      {id && <VerificacionInlinePanel buildingId={id} />}
      {/* Correcciones del equipo */}
      {id && <TeamFeedbackCard buildingId={id} />}

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
              const pctKnown = o.pct_propiedad != null;
              const pct = pctKnown ? Number(o.pct_propiedad) : 0;
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
                        {pctKnown && o.pct_normalizado && (
                          <span
                            className="col-start-3 font-mono text-[9px] uppercase tracking-eyebrow text-amber-500"
                            title={`Normalizado desde "${o.pct_raw ?? ""}"`}
                          >
                            norm
                          </span>
                        )}
                        {!pctKnown && o.pct_invalido && (
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
                    {assigned ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/comercial/preparar/${o.owner_id}`}>
                          <Phone className="h-3 w-3" /> Preparar
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled title="Edificio fuera de tu cartera">
                        <Phone className="h-3 w-3" /> Solo consulta
                      </Button>
                    )}
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

function DistribucionInmueble({ s }: { s: any }) {
  const items: { key: string; icon: any; label: string; units: number | null; m2: number | null }[] = [
    { key: "viviendas", icon: Home, label: "Viviendas", units: s?.num_viviendas ?? null, m2: s?.m2_viviendas ?? null },
    { key: "comercio", icon: Store, label: "Comercio", units: s?.comercio_unidades ?? null, m2: s?.m2_comercio ?? null },
    { key: "oficina", icon: Briefcase, label: "Oficina", units: s?.oficina_unidades ?? null, m2: s?.m2_oficina ?? null },
    { key: "almacen", icon: Package, label: "Almacén", units: s?.almacen_unidades ?? null, m2: s?.m2_almacen ?? null },
    { key: "aparcamiento", icon: Car, label: "Aparcamiento", units: s?.aparcamiento_unidades ?? null, m2: null },
    { key: "elementos_comunes", icon: Building, label: "Elementos comunes", units: s?.elementos_comunes_unidades ?? null, m2: s?.m2_elementos_comunes ?? null },
    { key: "ocio_hostel", icon: Hotel, label: "Ocio / Hostel", units: s?.ocio_hostel_unidades ?? null, m2: s?.m2_ocio_hostel ?? null },
    { key: "industrial", icon: Factory, label: "Industrial", units: s?.industrial_unidades ?? null, m2: s?.m2_industrial ?? null },
  ];
  const visible = items.filter((i) => (i.units ?? 0) > 0 || (i.m2 ?? 0) > 0);

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Distribución del inmueble</Eyebrow>
        <CardTitle>Usos por categoría</CardTitle>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No hay datos de distribución sincronizados desde HubSpot para este edificio.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map(({ key, icon: Icon, label, units, m2 }) => (
              <div
                key={key}
                className="rounded-md border border-border-faint bg-surface-1/40 p-3"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <div>
                    <div className="font-mono text-lg tabular-nums text-foreground">
                      {units ?? "—"}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                      unidades
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm tabular-nums text-foreground">
                      {m2 != null ? Number(m2).toLocaleString() : "—"}
                    </div>
                    <div className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                      m²
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

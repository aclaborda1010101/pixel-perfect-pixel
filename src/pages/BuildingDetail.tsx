import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { TeamFeedbackCard } from "@/components/comercial/TeamFeedbackCard";
import { VerificacionInlinePanel } from "@/components/comercial/VerificacionInlinePanel";
import { PgoumBlock } from "@/components/comercial/PgoumBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Building2, FileText, PhoneCall, MessageSquare, StickyNote, CheckSquare,
  Mail, Plus, MapPin, Calendar, Sparkles, Crown, Briefcase, X, AlertTriangle, ChevronDown, Network,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AddOwnerToBuildingDialog, SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";
import { RelationshipGraph } from "@/components/graph/RelationshipGraph";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOwnersCount } from "@/hooks/useOwnersCount";

const PAGE_SIZE = 50;

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "gold" | "warning" | "danger" }) {
  const cls =
    tone === "gold" ? "border-gold/60 bg-gold-soft/40 text-gold"
    : tone === "warning" ? "border-warning/40 bg-warning-soft/40 text-warning"
    : tone === "danger" ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-border text-muted-foreground";
  return (
    <span className={cn("rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow", cls)}>
      {children}
    </span>
  );
}

function fmtEUR(n: number | null | undefined) {
  if (n == null || !isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M€`;
  return `${v.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
}
function fmtDate(d?: string | null) { return d ? new Date(d).toLocaleDateString("es-ES") : "—"; }
function fmtDateTime(d?: string | null) { return d ? new Date(d).toLocaleString("es-ES") : "—"; }

type CommItem = {
  id: string; kind: "call" | "whatsapp" | "note" | "task";
  fecha: string; titulo: string; cuerpo: string; owner_id?: string | null; link?: string;
};

export default function BuildingDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [building, setBuilding] = useState<any>(null);
  const { data: ownersCount } = useOwnersCount(id);
  const [bos, setBos] = useState<any[]>([]);
  const [bcs, setBcs] = useState<any[]>([]);
  const [notas, setNotas] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [whats, setWhats] = useState<any[]>([]);
  const [ownerNotes, setOwnerNotes] = useState<any[]>([]);
  const [hsTasks, setHsTasks] = useState<any[]>([]);
  const [nextActions, setNextActions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // pagination per tab
  const [showPersonas, setShowPersonas] = useState(PAGE_SIZE);
  const [showEmpresas, setShowEmpresas] = useState(PAGE_SIZE);
  const [showNotas, setShowNotas] = useState(PAGE_SIZE);
  const [showComms, setShowComms] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data: b } = await supabase.from("buildings").select("*").eq("id", id).maybeSingle();
    setBuilding(b);

    const [{ data: bo }, { data: bc }, { data: ns }, { data: na }] = await Promise.all([
      supabase.from("building_owners")
        .select("building_id, owner_id, cuota, subrole, rol_notas, es_influencer, influencer_score, influencer_reason, owners:owner_id(id, nombre, rol, email, telefono, buyer_persona, metadatos)")
        .eq("building_id", id),
      supabase.from("building_companies")
        .select("id, role, percentage, fecha_inicio, fecha_fin, source, company:company_id(id, nombre, cif, email, telefono)")
        .eq("building_id", id),
      supabase.from("notas_simples")
        .select("id, status, riesgo, processed_at, created_at, file_url, structured_json")
        .eq("building_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("next_actions")
        .select("id, titulo, detalle, vencimiento, estado, scope_type, scope_id")
        .eq("scope_type", "building").eq("scope_id", id)
        .order("vencimiento", { ascending: true, nullsFirst: false }).limit(20),
    ]);
    setBos(bo ?? []);
    setBcs(bc ?? []);
    setNotas(ns ?? []);
    setNextActions(na ?? []);

    const ownerIds = (bo ?? []).map((r: any) => r.owner_id);
    if (ownerIds.length) {
      const [{ data: cs }, { data: ws }, { data: nts }] = await Promise.all([
        supabase.from("calls")
          .select("id, owner_id, fecha, resumen, direccion, duracion_seg")
          .in("owner_id", ownerIds).order("fecha", { ascending: false }).limit(500),
        supabase.from("whatsapp_messages")
          .select("id, owner_id, enviado_at, created_at, cuerpo, direccion, status")
          .in("owner_id", ownerIds).order("created_at", { ascending: false }).limit(500),
        supabase.from("notes")
          .select("id, owner_id, texto, etiquetas, created_at")
          .in("owner_id", ownerIds).order("created_at", { ascending: false }).limit(500),
      ]);
      setCalls(cs ?? []);
      setWhats(ws ?? []);
      setOwnerNotes(nts ?? []);

      // hubspot_tasks via owner email/phone is fuzzy; skip unless owner has hubspot id in metadatos
      setHsTasks([]);
    } else {
      setCalls([]); setWhats([]); setOwnerNotes([]); setHsTasks([]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const removeOwner = async (ownerId: string) => {
    const { error } = await supabase.from("building_owners").delete().eq("building_id", id).eq("owner_id", ownerId);
    if (error) return toast.error(error.message);
    toast.success("Propietario quitado"); load();
  };
  const recalcInfluencers = async () => {
    toast.info("Calculando influencer…");
    const { data, error } = await supabase.functions.invoke("detect_influencers", { body: { building_id: id } });
    if (error) return toast.error(error.message);
    toast.success(`Influencer recalculado (${(data as any)?.influencers_identified ?? 0})`);
    load();
  };

  // Derivados
  const comms: CommItem[] = useMemo(() => {
    const items: CommItem[] = [];
    for (const c of calls) items.push({
      id: `c-${c.id}`, kind: "call",
      fecha: c.fecha, titulo: `Llamada ${c.direccion ?? ""}`.trim(),
      cuerpo: c.resumen ?? "(sin resumen)", owner_id: c.owner_id, link: `/llamadas/${c.id}`,
    });
    for (const w of whats) items.push({
      id: `w-${w.id}`, kind: "whatsapp",
      fecha: w.enviado_at ?? w.created_at, titulo: `WhatsApp · ${w.status ?? "—"}`,
      cuerpo: w.cuerpo ?? "", owner_id: w.owner_id,
    });
    for (const n of ownerNotes) items.push({
      id: `n-${n.id}`, kind: "note",
      fecha: n.created_at, titulo: "Nota interna",
      cuerpo: n.texto ?? "", owner_id: n.owner_id,
    });
    for (const t of hsTasks) items.push({
      id: `t-${t.id}`, kind: "task",
      fecha: t.hs_timestamp ?? t.hs_createdate, titulo: t.hs_task_subject ?? "Tarea",
      cuerpo: t.hs_task_body ?? "",
    });
    return items.sort((a, b) => +new Date(b.fecha || 0) - +new Date(a.fecha || 0));
  }, [calls, whats, ownerNotes, hsTasks]);

  const ownerNameById = useMemo(() => {
    const m = new Map<string, string>();
    bos.forEach((r) => m.set(r.owner_id, r.owners?.nombre ?? "—"));
    return m;
  }, [bos]);

  const ultimoContacto = comms[0];
  const proximaAccion = nextActions.find((a) => a.estado !== "completada") ?? null;

  const hipotecasActivas = useMemo(() => {
    let total = 0; let count = 0; const acreedores = new Set<string>();
    for (const n of notas) {
      const cargas = (n.structured_json?.cargas ?? []) as any[];
      for (const c of cargas) {
        if (/hipoteca/i.test(c.tipo ?? "") && !/cancelad/i.test(c.notas ?? "")) {
          const imp = Number(c.importe); if (isFinite(imp)) total += imp;
          count++;
          if (c.acreedor) acreedores.add(c.acreedor);
        }
      }
    }
    return { total, count, acreedores: Array.from(acreedores) };
  }, [notas]);

  if (loading || !building) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  const existingOwnerIds = bos.map((r) => r.owner_id);
  // Porcentaje efectivo: cuota propia del edificio si existe, si no el porcentaje_de_participacion de HubSpot
  const pctOf = (r: any): number | null => {
    if (r.cuota != null && r.cuota !== "") {
      const n = Number(r.cuota);
      if (isFinite(n)) return n;
    }
    const raw = r.owners?.metadatos?.porcentaje_de_participacion;
    if (raw == null) return null;
    const n = Number(String(raw).replace(",", ".").replace(/[^\d.]/g, ""));
    return isFinite(n) && n > 0 ? n : null;
  };
  const totalCuota = bos.reduce((a, r) => a + (pctOf(r) ?? 0), 0);
  const personas = bos;
  const empresas = bcs;
  const isDH = !!building.division_horizontal;
  // En DH agrupamos titulares por nota (cada nota = una finca/vivienda)
  const fincas = useMemoFincas(notas);
  const cuotaInconsistente = !isDH && totalCuota > 100.5;

  return (
    <div className="w-full min-w-0 space-y-6">
      <Crumbs items={[{ label: "Edificios", to: "/edificios" }, { label: building.direccion }]} />

      <PageHeader
        eyebrow={`Edificio · ${building.ciudad ?? "Madrid"}`}
        title={building.direccion}
        subtitle={`${building.ciudad ?? "Madrid"}${building.codigo_postal ? ` · ${building.codigo_postal}` : ""}${building.catastro_ref ? ` · ${building.catastro_ref}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm"><Mail className="h-4 w-4" />Email</Button>
            <Button variant="outline" size="sm"><FileText className="h-4 w-4" />Documentos</Button>
            <Button variant="gold" size="sm"><Plus className="h-4 w-4" />Nueva acción</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip>{building.estado}</Chip>
        {building.division_horizontal && <Chip tone="gold">División horizontal</Chip>}
        {(ownersCount ?? building.numero_propietarios) != null && (
          <Chip>{ownersCount ?? building.numero_propietarios} propietarios</Chip>
        )}
        {hipotecasActivas.count > 0 && <Chip tone="warning">{hipotecasActivas.count} hipoteca{hipotecasActivas.count > 1 ? "s" : ""}</Chip>}
        {notas.some((n) => n.riesgo === "alto") && <Chip tone="danger">Riesgo alto</Chip>}
      </div>

      {/* KPIs reales */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card><CardContent className="p-5">
          <Eyebrow>Personas</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{personas.length}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">propietarios físicos</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>Empresas</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{empresas.length}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">titulares jurídicos</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          {isDH ? (
            <>
              <Eyebrow>Viviendas / fincas</Eyebrow>
              <div className="mt-2"><MetricValue size="lg">{fincas.length || notas.length}</MetricValue></div>
              <p className="mt-1 text-xs text-muted-foreground">edificio en división horizontal</p>
            </>
          ) : (
            <>
              <Eyebrow>Cuota total</Eyebrow>
              <div className="mt-2"><MetricValue size="lg" unit="%">{totalCuota.toFixed(0)}</MetricValue></div>
              <p className={cn("mt-1 text-xs", cuotaInconsistente ? "text-destructive" : "text-muted-foreground")}>
                {cuotaInconsistente ? "⚠ inconsistente — revisar notas" : "sumatorio cuotas"}
              </p>
            </>
          )}
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>Hipotecas activas</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{fmtEUR(hipotecasActivas.total)}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">{hipotecasActivas.count} carga{hipotecasActivas.count === 1 ? "" : "s"}</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>Notas simples</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{notas.length}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">{notas.filter((n) => n.status === "listo").length} procesadas</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="resumen">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="w-max md:w-auto">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="personas">Personas {personas.length || ""}</TabsTrigger>
            <TabsTrigger value="empresas">Empresas {empresas.length || ""}</TabsTrigger>
            <TabsTrigger value="notas">Notas Simples {notas.length || ""}</TabsTrigger>
            <TabsTrigger value="comms">Comunicaciones {comms.length || ""}</TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
            <TabsTrigger value="docs">Documentos</TabsTrigger>
            <TabsTrigger value="grafo"><Network className="mr-1 h-3 w-3" /> Grafo</TabsTrigger>
          </TabsList>
        </div>

        {/* RESUMEN */}
        <TabsContent value="resumen" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader><Eyebrow>Registro</Eyebrow><CardTitle>Catastro</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  {[
                    ["Referencia catastral", building.catastro_ref ?? "—"],
                    ["Dirección", building.direccion],
                    ["Ciudad", building.ciudad ?? "—"],
                    ["CP", building.codigo_postal ?? "—"],
                    ["DH", building.division_horizontal ? "Sí" : "No"],
                    ["Sync", fmtDate(building.last_synced_at)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border-faint py-1">
                      <dt className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{k}</dt>
                      <dd className="font-mono text-sm tabular-nums text-foreground text-right truncate">{v as any}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><Eyebrow>Actividad</Eyebrow><CardTitle>Último contacto</CardTitle></CardHeader>
              <CardContent>
                {ultimoContacto ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Chip tone="gold">{ultimoContacto.kind}</Chip>
                      <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{fmtDateTime(ultimoContacto.fecha)}</span>
                    </div>
                    <div className="text-sm text-foreground">{ultimoContacto.titulo}</div>
                    <div className="text-xs text-muted-foreground line-clamp-3">{ultimoContacto.cuerpo}</div>
                    {ultimoContacto.owner_id && (
                      <Link to={`/propietarios/${ultimoContacto.owner_id}`} className="block text-xs text-gold hover:underline">
                        {ownerNameById.get(ultimoContacto.owner_id) ?? "Ver propietario"} →
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin actividad registrada.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><Eyebrow>Cargas</Eyebrow><CardTitle>Hipotecas activas</CardTitle></CardHeader>
              <CardContent>
                {hipotecasActivas.count > 0 ? (
                  <div className="space-y-2">
                    <MetricValue size="lg">{fmtEUR(hipotecasActivas.total)}</MetricValue>
                    <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                      {hipotecasActivas.count} carga{hipotecasActivas.count === 1 ? "" : "s"} · {hipotecasActivas.acreedores.length} acreedor{hipotecasActivas.acreedores.length === 1 ? "" : "es"}
                    </p>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {hipotecasActivas.acreedores.slice(0, 4).map((a) => <Chip key={a}>{a}</Chip>)}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin hipotecas detectadas en notas simples.</p>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2 lg:col-span-3">
              <CardHeader><Eyebrow>Agenda</Eyebrow><CardTitle>Próxima acción</CardTitle></CardHeader>
              <CardContent>
                {proximaAccion ? (
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground">{proximaAccion.titulo}</div>
                      {proximaAccion.detalle && <div className="text-xs text-muted-foreground">{proximaAccion.detalle}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip tone="gold">{proximaAccion.estado}</Chip>
                      <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{fmtDate(proximaAccion.vencimiento)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No hay acciones programadas para este edificio.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* PERSONAS */}
        <TabsContent value="personas" className="space-y-3">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={recalcInfluencers}>
              <Sparkles className="mr-1 h-3 w-3" /> Recalcular influencers
            </Button>
            <AddOwnerToBuildingDialog buildingId={id} existingOwnerIds={existingOwnerIds} onAdded={load} />
          </div>
          {personas.length === 0 ? (
            <EmptyState icon={Users} title="Sin propietarios físicos" description="Añade propietarios con su rol y cuota." />
          ) : (
            <Card>
              <ul className="divide-y divide-border-faint">
                {personas.slice(0, showPersonas).map((r) => (
                  <li key={r.owner_id} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link to={`/propietarios/${r.owner_id}`} className="block truncate text-sm font-medium text-foreground hover:text-gold">{r.owners?.nombre}</Link>
                        {r.es_influencer && (
                          <TooltipProvider><Tooltip><TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 rounded-[3px] border border-gold/60 bg-gold-soft/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-gold">
                              <Crown className="h-3 w-3" /> Influencer
                            </span>
                          </TooltipTrigger><TooltipContent>
                            <div className="text-xs">
                              <div className="font-mono">score {r.influencer_score ?? "—"}</div>
                              <div>{r.influencer_reason ?? "sin razón"}</div>
                            </div>
                          </TooltipContent></Tooltip></TooltipProvider>
                        )}
                      </div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {r.owners?.email ?? r.owners?.telefono ?? "—"}
                        {r.rol_notas ? ` · ${r.rol_notas}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(() => {
                        const pct = pctOf(r);
                        if (pct == null) return null;
                        const fromHs = r.cuota == null || r.cuota === "";
                        return (
                          <Badge variant="gold" title={fromHs ? "Porcentaje de participación (HubSpot)" : "Cuota del edificio"}>
                            {Number(pct.toFixed(2))}%
                          </Badge>
                        );
                      })()}
                      <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                      {r.owners?.rol && <Badge variant="info">{r.owners.rol}</Badge>}
                      <Button size="icon" variant="ghost" onClick={() => removeOwner(r.owner_id)}><X className="h-3 w-3" /></Button>
                    </div>
                  </li>
                ))}
              </ul>
              {personas.length > showPersonas && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowPersonas((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({personas.length - showPersonas} restantes)
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* EMPRESAS */}
        <TabsContent value="empresas" className="space-y-3">
          {empresas.length === 0 ? (
            <EmptyState icon={Building2} title="Sin empresas titulares" description="Las sociedades titulares aparecerán aquí cuando se vinculen desde notas simples u otros orígenes." />
          ) : (
            <Card>
              <ul className="divide-y divide-border-faint">
                {empresas.slice(0, showEmpresas).map((r) => (
                  <li key={r.id} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{r.company?.nombre ?? "—"}</div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                        {r.company?.cif ?? "sin CIF"}
                        {r.company?.email ? ` · ${r.company.email}` : ""}
                        {r.company?.telefono ? ` · ${r.company.telefono}` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.percentage != null && <Badge variant="gold">{r.percentage}%</Badge>}
                      <Badge variant="outline">{r.role}</Badge>
                      {r.source && <Chip>{r.source}</Chip>}
                    </div>
                  </li>
                ))}
              </ul>
              {empresas.length > showEmpresas && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowEmpresas((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({empresas.length - showEmpresas} restantes)
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* NOTAS SIMPLES */}
        <TabsContent value="notas" className="space-y-3">
          {notas.length === 0 ? (
            <EmptyState icon={FileText} title="Sin notas simples" description="Las notas simples vinculadas a este edificio aparecerán aquí." />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {notas.slice(0, showNotas).map((n) => {
                  const sj = n.structured_json ?? {};
                  const titulares = (sj.titulares ?? []) as any[];
                  const cargas = (sj.cargas ?? []) as any[];
                  return (
                    <Card key={n.id} className="overflow-hidden">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <Eyebrow>{fmtDate(n.processed_at ?? n.created_at)}</Eyebrow>
                            <CardTitle className="truncate text-base">
                              {sj.finca?.ref_catastral ?? sj.finca?.numero ?? "Nota simple"}
                            </CardTitle>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {n.riesgo && <Chip tone={n.riesgo === "alto" ? "danger" : n.riesgo === "medio" ? "warning" : "default"}>Riesgo {n.riesgo}</Chip>}
                            <Chip tone={n.status === "listo" ? "gold" : "default"}>{n.status}</Chip>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 pt-0">
                        {titulares.length > 0 && (
                          <div>
                            <Eyebrow>Titulares ({titulares.length})</Eyebrow>
                            <ul className="mt-1 space-y-1">
                              {titulares.slice(0, 4).map((t: any, i: number) => (
                                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                                  <span className="truncate text-foreground">{t.nombre}</span>
                                  <span className="font-mono tabular-nums text-muted-foreground">
                                    {t.porcentaje ? `${t.porcentaje}%` : ""}{t.rol ? ` · ${t.rol}` : ""}
                                  </span>
                                </li>
                              ))}
                              {titulares.length > 4 && <li className="text-[11px] text-muted-foreground">+{titulares.length - 4} más</li>}
                            </ul>
                          </div>
                        )}
                        {cargas.length > 0 && (
                          <div>
                            <Eyebrow>Cargas ({cargas.length})</Eyebrow>
                            <ul className="mt-1 space-y-1">
                              {cargas.slice(0, 4).map((c: any, i: number) => (
                                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                                  <span className="truncate text-foreground">
                                    <Chip tone={/hipoteca/i.test(c.tipo ?? "") ? "warning" : "default"}>{c.tipo ?? "—"}</Chip>{" "}
                                    {c.acreedor ?? ""}
                                  </span>
                                  <span className="font-mono tabular-nums text-muted-foreground">
                                    {c.importe ? fmtEUR(Number(c.importe)) : ""}
                                  </span>
                                </li>
                              ))}
                              {cargas.length > 4 && <li className="text-[11px] text-muted-foreground">+{cargas.length - 4} más</li>}
                            </ul>
                          </div>
                        )}
                        <div className="flex justify-end pt-1">
                          {n.file_url && (
                            <a href={n.file_url} target="_blank" rel="noreferrer" className="text-xs text-gold hover:underline">Abrir PDF →</a>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
              {notas.length > showNotas && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowNotas((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({notas.length - showNotas} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* COMUNICACIONES */}
        <TabsContent value="comms" className="space-y-3">
          {comms.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Sin comunicaciones" description="Llamadas, WhatsApp, notas internas y tareas asociadas a los propietarios aparecerán aquí." />
          ) : (
            <Card>
              <ol className="relative space-y-0 divide-y divide-border-faint">
                {comms.slice(0, showComms).map((c) => {
                  const Icon = c.kind === "call" ? PhoneCall : c.kind === "whatsapp" ? MessageSquare : c.kind === "note" ? StickyNote : CheckSquare;
                  const tone = c.kind === "call" ? "default" : c.kind === "whatsapp" ? "gold" : c.kind === "note" ? "default" : "warning";
                  return (
                    <li key={c.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-1/30">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-border-faint bg-surface-1/40 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Chip tone={tone as any}>{c.kind}</Chip>
                          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{fmtDateTime(c.fecha)}</span>
                          {c.owner_id && (
                            <Link to={`/propietarios/${c.owner_id}`} className="truncate text-[11px] text-muted-foreground hover:text-gold">
                              · {ownerNameById.get(c.owner_id) ?? "owner"}
                            </Link>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-foreground">{c.titulo}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{c.cuerpo}</div>
                      </div>
                      {c.link && <Link to={c.link} className="shrink-0 text-xs text-gold hover:underline">Abrir →</Link>}
                    </li>
                  );
                })}
              </ol>
              {comms.length > showComms && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowComms((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({comms.length - showComms} restantes)
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* DEALS */}
        <TabsContent value="deals">
          <EmptyState icon={Briefcase} title="Deals" description="Las oportunidades (deals) vinculadas a este edificio aparecerán aquí cuando estén disponibles en el pipeline." />
        </TabsContent>

        {/* DOCUMENTOS */}
        <TabsContent value="docs">
          <EmptyState icon={FileText} title="Documentos" description="Archivo notarial, ITE, escrituras y cuotas. Próximamente." />
        </TabsContent>

        {/* GRAFO */}
        <TabsContent value="grafo">
          <RelationshipGraph
            center={{
              kind: "building",
              label: building.direccion,
              sublabel: [building.ciudad, building.catastro_ref].filter(Boolean).join(" · "),
            }}
            owners={personas.map((p: any) => ({
              id: p.owner_id ?? p.id,
              kind: "owner" as const,
              label: p.owner?.nombre ?? p.nombre ?? "Propietario",
              sublabel: [p.subrole && p.subrole !== "ninguno" ? (SUBROLE_LABEL[p.subrole] ?? p.subrole) : null, (() => { const x = pctOf(p); return x != null ? `${Number(x.toFixed(2))}%` : null; })()].filter(Boolean).join(" · "),
              href: `/propietarios/${p.owner_id ?? p.id}`,
              badge: p.es_influencer ? "influencer" : undefined,
            }))}
            companies={empresas.map((e: any) => ({
              id: e.company_id ?? e.id,
              kind: "company" as const,
              label: e.company?.nombre ?? e.nombre ?? "Empresa",
              sublabel: [e.role, e.percentage ? `${e.percentage}%` : null].filter(Boolean).join(" · "),
              href: `/empresas/${e.company_id ?? e.id}`,
            }))}
            notas={notas.map((n: any) => ({
              id: n.id,
              kind: "nota" as const,
              label: n.structured_json?.finca?.ref_catastral || "Nota simple",
              sublabel: n.status,
              href: `/notas-simples/${n.id}`,
              badge: n.riesgo || undefined,
            }))}
          />
        </TabsContent>
      </Tabs>
      {id && <div className="mt-6 space-y-6"><PgoumBlock buildingId={id} /><VerificacionInlinePanel buildingId={id} /><TeamFeedbackCard buildingId={id} /></div>}
    </div>
  );
}

import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sparkles, Building2, Boxes, Users2, Briefcase, FileText, PhoneCall, MessageSquare,
  StickyNote, CheckSquare, ChevronDown, ArrowRight, ArrowLeft, Network,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PreCallBrief } from "@/components/agents/PreCallBrief";
import { AnalyzeNote } from "@/components/agents/AnalyzeNote";
import { CatalogRoleButton } from "@/components/agents/CatalogRoleButton";
import { RagSearch } from "@/components/agents/RagSearch";
import { WhatsappComposer } from "@/components/comms/WhatsappComposer";
import { RelationshipGraph } from "@/components/graph/RelationshipGraph";
import { SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const PERSONAS: { value: string; label: string }[] = [
  { value: "sin_clasificar", label: "Sin clasificar" },
  { value: "cansado", label: "Cansado" },
  { value: "desplazado", label: "Desplazado" },
  { value: "controla", label: "Controla" },
  { value: "ego", label: "Ego" },
  { value: "no_traspasa", label: "No traspasa" },
  { value: "vive_edificio", label: "Vive edificio" },
  { value: "no_primero", label: "No primero" },
];
const PERSONA_LABEL: Record<string, string> = Object.fromEntries(PERSONAS.map((p) => [p.value, p.label]));

const RELATION_LABEL: Record<string, string> = {
  heredero_de: "heredero/a de",
  conyuge_de: "cónyuge de",
  representante_de: "representante de",
  apoderado_de: "apoderado de",
  padre_de: "padre/madre de",
  socio_de: "socio de",
};

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
const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("es-ES") : "—";
const fmtDateTime = (d?: string | null) => d ? new Date(d).toLocaleString("es-ES") : "—";

type Owner = {
  id: string; nombre: string; email: string | null; telefono: string | null;
  rol: string; subrole: string; buyer_persona: string;
  rol_confianza: number | null; rol_justificacion: string | null;
  consentimiento: boolean; notas_breves: string | null;
};

type CommItem = {
  id: string; kind: "call" | "whatsapp" | "note" | "task";
  fecha: string; titulo: string; cuerpo: string; link?: string;
};

export default function OwnerDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [owner, setOwner] = useState<Owner | null>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [whats, setWhats] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [actions, setActions] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [buildings, setBuildings] = useState<any[]>([]);
  const [relations, setRelations] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [titulares, setTitulares] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showEdif, setShowEdif] = useState(PAGE_SIZE);
  const [showAct, setShowAct] = useState(PAGE_SIZE);
  const [showRel, setShowRel] = useState(PAGE_SIZE);
  const [showEmp, setShowEmp] = useState(PAGE_SIZE);
  const [showComms, setShowComms] = useState(PAGE_SIZE);
  const [showDocs, setShowDocs] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [o, c, w, n, a, as, bo, relA, relB, oc, ts] = await Promise.all([
      supabase.from("owners").select("*").eq("id", id).maybeSingle(),
      supabase.from("calls").select("id, fecha, resumen, direccion, duracion_seg").eq("owner_id", id).order("fecha", { ascending: false }).limit(500),
      supabase.from("whatsapp_messages").select("id, enviado_at, created_at, cuerpo, status, direccion").eq("owner_id", id).order("created_at", { ascending: false }).limit(500),
      supabase.from("notes").select("*").eq("owner_id", id).order("created_at", { ascending: false }).limit(500),
      supabase.from("next_actions").select("*").eq("owner_id", id).order("vencimiento", { ascending: true, nullsFirst: false }).limit(100),
      supabase.from("assets").select("*").eq("owner_id", id).limit(500),
      supabase.from("building_owners").select("building_id, cuota, subrole, rol_notas, buildings:building_id(id, direccion, ciudad)").eq("owner_id", id),
      supabase.from("owner_relations").select("id, relation_type, percentage, notes, source, owner_b:owner_b_id(id, nombre)").eq("owner_a_id", id),
      supabase.from("owner_relations").select("id, relation_type, percentage, notes, source, owner_a:owner_a_id(id, nombre)").eq("owner_b_id", id),
      supabase.from("owner_companies").select("id, role, percentage, source, company:company_id(id, nombre, cif)").eq("owner_id", id),
      supabase.from("nota_simple_titulares")
        .select("id, rol, porcentaje, cif_dni, nombre_extraido, nota_simple_id, nota:nota_simple_id(id, status, riesgo, processed_at, created_at, file_url, building_id, structured_json)")
        .eq("owner_id", id),
    ]);
    setOwner(o.data as Owner);
    setCalls(c.data ?? []); setWhats(w.data ?? []); setNotes(n.data ?? []);
    setActions(a.data ?? []); setAssets(as.data ?? []); setBuildings(bo.data ?? []);
    const relsOut = (relA.data ?? []).map((r: any) => ({ ...r, direction: "out", other: r.owner_b }));
    const relsIn = (relB.data ?? []).map((r: any) => ({ ...r, direction: "in", other: r.owner_a }));
    setRelations([...relsOut, ...relsIn]);
    setCompanies(oc.data ?? []);
    setTitulares(ts.data ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const comms: CommItem[] = useMemo(() => {
    const items: CommItem[] = [];
    for (const c of calls) items.push({
      id: `c-${c.id}`, kind: "call", fecha: c.fecha,
      titulo: `Llamada ${c.direccion ?? ""}`.trim(), cuerpo: c.resumen ?? "(sin resumen)",
      link: `/llamadas/${c.id}`,
    });
    for (const w of whats) items.push({
      id: `w-${w.id}`, kind: "whatsapp", fecha: w.enviado_at ?? w.created_at,
      titulo: `WhatsApp · ${w.status ?? "—"}`, cuerpo: w.cuerpo ?? "",
    });
    for (const n of notes) items.push({
      id: `n-${n.id}`, kind: "note", fecha: n.created_at,
      titulo: "Nota interna", cuerpo: n.texto ?? "",
    });
    return items.sort((a, b) => +new Date(b.fecha || 0) - +new Date(a.fecha || 0));
  }, [calls, whats, notes]);

  if (loading || !owner) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  return (
    <div className="w-full min-w-0 space-y-6">
      <Crumbs items={[{ label: "Propietarios", to: "/propietarios" }, { label: owner.nombre }]} />
      <PageHeader
        eyebrow="Propietario · Ficha"
        title={owner.nombre}
        subtitle={owner.email ?? owner.telefono ?? ""}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={owner.buyer_persona === "sin_clasificar" ? "outline" : "gold"}>
              {PERSONA_LABEL[owner.buyer_persona] ?? owner.buyer_persona}
            </Badge>
            {owner.subrole && owner.subrole !== "ninguno" && (
              <Badge variant="outline">{SUBROLE_LABEL[owner.subrole] ?? owner.subrole}</Badge>
            )}
            {owner.consentimiento && <Badge variant="success">Consentimiento</Badge>}
          </div>
        }
      />

      {/* KPIs reales */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card><div className="p-4 md:p-5"><Eyebrow>Edificios</Eyebrow><div className="mt-2"><MetricValue size="lg">{buildings.length}</MetricValue></div></div></Card>
        <Card><div className="p-4 md:p-5"><Eyebrow>Activos</Eyebrow><div className="mt-2"><MetricValue size="lg">{assets.length}</MetricValue></div></div></Card>
        <Card><div className="p-4 md:p-5"><Eyebrow>Relaciones</Eyebrow><div className="mt-2"><MetricValue size="lg">{relations.length}</MetricValue></div></div></Card>
        <Card><div className="p-4 md:p-5"><Eyebrow>Empresas</Eyebrow><div className="mt-2"><MetricValue size="lg">{companies.length}</MetricValue></div></div></Card>
        <Card><div className="p-4 md:p-5"><Eyebrow>Comms</Eyebrow><div className="mt-2"><MetricValue size="lg">{comms.length}</MetricValue></div></div></Card>
        <Card><div className="p-4 md:p-5"><Eyebrow>Documentos</Eyebrow><div className="mt-2"><MetricValue size="lg">{titulares.length}</MetricValue></div></div></Card>
      </div>

      <Tabs defaultValue="resumen" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="w-max md:w-auto">
            <TabsTrigger value="resumen">Resumen</TabsTrigger>
            <TabsTrigger value="edificios">Edificios {buildings.length || ""}</TabsTrigger>
            <TabsTrigger value="activos">Activos {assets.length || ""}</TabsTrigger>
            <TabsTrigger value="relaciones">Relaciones {relations.length || ""}</TabsTrigger>
            <TabsTrigger value="empresas">Empresas {companies.length || ""}</TabsTrigger>
            <TabsTrigger value="comms">Comunicaciones {comms.length || ""}</TabsTrigger>
            <TabsTrigger value="docs">Documentos {titulares.length || ""}</TabsTrigger>
            <TabsTrigger value="deals">Deals</TabsTrigger>
            <TabsTrigger value="grafo"><Network className="mr-1 h-3 w-3" /> Grafo</TabsTrigger>
            <TabsTrigger value="ai"><Sparkles className="mr-1 h-3 w-3" /> IA</TabsTrigger>
          </TabsList>
        </div>

        {/* RESUMEN */}
        <TabsContent value="resumen" className="space-y-4">
          <Card>
            <CardHeader><Eyebrow>Datos del contacto</Eyebrow><CardTitle>Ficha</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm md:grid-cols-2">
              <Field label="Email" value={owner.email} />
              <Field label="Teléfono" value={owner.telefono} />
              <Field label="Consentimiento" value={owner.consentimiento ? "Sí" : "No"} />
              <Field label="Justificación rol" value={owner.rol_justificacion} />
              <div>
                <Eyebrow>Buyer persona</Eyebrow>
                <div className="mt-1">
                  <Select
                    value={owner.buyer_persona}
                    onValueChange={async (v) => {
                      const prev = owner.buyer_persona;
                      setOwner({ ...owner, buyer_persona: v });
                      const { error } = await supabase.from("owners").update({ buyer_persona: v as any }).eq("id", owner.id);
                      if (error) setOwner({ ...owner, buyer_persona: prev });
                    }}
                  >
                    <SelectTrigger className="h-8 w-[220px] text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PERSONAS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="md:col-span-2"><Field label="Notas breves" value={owner.notas_breves} /></div>
            </CardContent>
          </Card>

          {actions.length > 0 && (
            <Card>
              <CardHeader><Eyebrow>Agenda</Eyebrow><CardTitle>Próximas acciones</CardTitle></CardHeader>
              <CardContent>
                <ul className="divide-y divide-border-faint">
                  {actions.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground">{a.titulo}</div>
                        {a.detalle && <div className="text-xs text-muted-foreground">{a.detalle}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Chip tone={a.estado === "pendiente" ? "warning" : "default"}>{a.estado}</Chip>
                        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{fmtDate(a.vencimiento)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* EDIFICIOS */}
        <TabsContent value="edificios">
          {buildings.length === 0 ? (
            <EmptyState icon={Building2} title="No participa en ningún edificio" description="Vincula este propietario desde la ficha del edificio." />
          ) : (
            <Card>
              <ul className="divide-y divide-border-faint">
                {buildings.slice(0, showEdif).map((b: any) => (
                  <li key={b.building_id}>
                    <Link to={`/edificios/${b.building_id}`} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{b.buildings?.direccion}</div>
                        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          {b.buildings?.ciudad}{b.rol_notas ? ` · ${b.rol_notas}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {b.cuota != null && <Badge variant="gold">{b.cuota}%</Badge>}
                        <Badge variant="outline">{SUBROLE_LABEL[b.subrole] ?? b.subrole}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {buildings.length > showEdif && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowEdif((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({buildings.length - showEdif})
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* ACTIVOS */}
        <TabsContent value="activos">
          {assets.length === 0 ? (
            <EmptyState icon={Boxes} title="Sin activos" description="No hay activos asignados a este propietario." />
          ) : (
            <Card>
              <ul className="divide-y divide-border-faint">
                {assets.slice(0, showAct).map((a) => (
                  <li key={a.id}>
                    <Link to={`/activos/${a.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                      <div className="text-sm font-medium text-foreground">{a.tipo} · {a.ubicacion}</div>
                      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{a.estado} · {a.superficie_m2 ?? "?"} m²</div>
                    </Link>
                  </li>
                ))}
              </ul>
              {assets.length > showAct && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowAct((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({assets.length - showAct})
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* RELACIONES (árbol) */}
        <TabsContent value="relaciones">
          {relations.length === 0 ? (
            <EmptyState icon={Users2} title="Sin relaciones registradas" description="Las relaciones (herederos, cónyuge, representantes…) se detectan automáticamente al procesar notas simples." />
          ) : (
            <Card>
              <div className="p-4">
                <div className="mb-4 flex items-center gap-2 rounded-[4px] border border-gold/40 bg-gold-soft/30 px-3 py-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gold/60 bg-background text-xs font-mono text-gold">YO</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{owner.nombre}</div>
                    <Eyebrow>{relations.length} relación{relations.length === 1 ? "" : "es"}</Eyebrow>
                  </div>
                </div>
                <ol className="relative space-y-2 border-l-2 border-border-faint pl-5">
                  {relations.slice(0, showRel).map((r: any) => {
                    const isOut = r.direction === "out";
                    const other = r.other;
                    const Arrow = isOut ? ArrowRight : ArrowLeft;
                    return (
                      <li key={r.id} className="relative">
                        <span className="absolute -left-[27px] top-3 flex h-4 w-4 items-center justify-center rounded-full border border-gold/60 bg-background">
                          <Arrow className="h-2.5 w-2.5 text-gold" />
                        </span>
                        <div className="flex flex-col items-start gap-2 rounded-[4px] border border-border-faint p-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Chip tone="gold">{RELATION_LABEL[r.relation_type] ?? r.relation_type}</Chip>
                              {!isOut && <Chip>recíproca</Chip>}
                            </div>
                            <Link to={`/propietarios/${other?.id ?? ""}`} className="mt-1 block truncate text-sm font-medium text-foreground hover:text-gold">
                              {other?.nombre ?? "—"}
                            </Link>
                            {r.notes && <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.notes}</div>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {r.percentage != null && <Badge variant="gold">{r.percentage}%</Badge>}
                            {r.source && <Chip>{r.source}</Chip>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {relations.length > showRel && (
                  <div className="mt-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setShowRel((s) => s + PAGE_SIZE)}>
                      <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({relations.length - showRel})
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* EMPRESAS */}
        <TabsContent value="empresas">
          {companies.length === 0 ? (
            <EmptyState icon={Building2} title="Sin empresas asociadas" description="No hay sociedades vinculadas a este propietario." />
          ) : (
            <Card>
              <ul className="divide-y divide-border-faint">
                {companies.slice(0, showEmp).map((r: any) => (
                  <li key={r.id} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{r.company?.nombre ?? "—"}</div>
                      <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{r.company?.cif ?? "sin CIF"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.percentage != null && <Badge variant="gold">{r.percentage}%</Badge>}
                      <Badge variant="outline">{r.role}</Badge>
                      {r.source && <Chip>{r.source}</Chip>}
                    </div>
                  </li>
                ))}
              </ul>
              {companies.length > showEmp && (
                <div className="p-3 text-center border-t border-border-faint">
                  <Button variant="ghost" size="sm" onClick={() => setShowEmp((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({companies.length - showEmp})
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* COMUNICACIONES */}
        <TabsContent value="comms" className="space-y-3">
          <WhatsappComposer ownerId={owner.id} ownerName={owner.nombre} />
          {comms.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Sin comunicaciones" description="Las llamadas, WhatsApp, notas y tareas aparecerán aquí." />
          ) : (
            <Card>
              <ol className="divide-y divide-border-faint">
                {comms.slice(0, showComms).map((c) => {
                  const Icon = c.kind === "call" ? PhoneCall : c.kind === "whatsapp" ? MessageSquare : c.kind === "note" ? StickyNote : CheckSquare;
                  const tone: any = c.kind === "whatsapp" ? "gold" : c.kind === "task" ? "warning" : "default";
                  return (
                    <li key={c.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-1/30">
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-border-faint bg-surface-1/40 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Chip tone={tone}>{c.kind}</Chip>
                          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{fmtDateTime(c.fecha)}</span>
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
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({comms.length - showComms})
                  </Button>
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* DOCUMENTOS (notas simples donde aparece como titular) */}
        <TabsContent value="docs">
          {titulares.length === 0 ? (
            <EmptyState icon={FileText} title="Sin documentos" description="No aparece como titular en ninguna nota simple procesada." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {titulares.slice(0, showDocs).map((tt: any) => {
                const n = tt.nota; if (!n) return null;
                const sj = n.structured_json ?? {};
                return (
                  <Card key={tt.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <Eyebrow>{fmtDate(n.processed_at ?? n.created_at)}</Eyebrow>
                          <CardTitle className="truncate text-base">{sj.finca?.ref_catastral ?? sj.finca?.numero ?? "Nota simple"}</CardTitle>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {n.riesgo && <Chip tone={n.riesgo === "alto" ? "danger" : n.riesgo === "medio" ? "warning" : "default"}>Riesgo {n.riesgo}</Chip>}
                          <Chip tone={n.status === "listo" ? "gold" : "default"}>{n.status}</Chip>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 pt-0 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Rol</span>
                        <span className="font-mono">{tt.rol}{tt.porcentaje ? ` · ${tt.porcentaje}%` : ""}</span>
                      </div>
                      {tt.cif_dni && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">DNI/CIF</span>
                          <span className="font-mono">{tt.cif_dni}</span>
                        </div>
                      )}
                      {n.building_id && (
                        <Link to={`/edificios/${n.building_id}`} className="block pt-1 text-gold hover:underline">Ir al edificio →</Link>
                      )}
                      {n.file_url && (
                        <a href={n.file_url} target="_blank" rel="noreferrer" className="block text-gold hover:underline">Abrir PDF →</a>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {titulares.length > showDocs && (
                <div className="md:col-span-2 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowDocs((s) => s + PAGE_SIZE)}>
                    <ChevronDown className="mr-1 h-3 w-3" /> Mostrar más ({titulares.length - showDocs})
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* DEALS */}
        <TabsContent value="deals">
          <EmptyState icon={Briefcase} title="Deals" description="Las oportunidades vinculadas a este propietario aparecerán aquí cuando estén disponibles en el pipeline." />
        </TabsContent>

        {/* GRAFO */}
        <TabsContent value="grafo">
          <RelationshipGraph
            center={{
              kind: "owner",
              label: owner.nombre,
              sublabel: `${owner.rol}${owner.subrole && owner.subrole !== "ninguno" ? " · " + (SUBROLE_LABEL[owner.subrole] ?? owner.subrole) : ""}`,
            }}
            buildings={buildings.map((b: any) => ({
              id: b.id,
              kind: "building" as const,
              label: b.direccion || "Sin dirección",
              sublabel: b.ciudad,
              href: `/edificios/${b.id}`,
              badge: b.subrole && b.subrole !== "ninguno" ? b.subrole : undefined,
            }))}
            companies={companies.map((c: any) => ({
              id: c.id,
              kind: "company" as const,
              label: c.nombre,
              sublabel: c.cif,
              href: `/empresas/${c.id}`,
              badge: c.role,
            }))}
            notas={titulares.map((tt: any) => ({
              id: tt.id,
              kind: "nota" as const,
              label: tt.nota?.structured_json?.finca?.ref_catastral || "Nota simple",
              sublabel: tt.rol + (tt.porcentaje ? ` · ${tt.porcentaje}%` : ""),
              href: tt.nota_simple_id ? `/notas-simples/${tt.nota_simple_id}` : undefined,
            }))}
          />
        </TabsContent>

        {/* IA */}
        <TabsContent value="ai" className="space-y-4">
          <CatalogRoleButton ownerId={owner.id} onDone={() => window.location.reload()} />
          <PreCallBrief ownerId={owner.id} />
          <AnalyzeNote ownerId={owner.id} />
          <RagSearch scopeType="owner" scopeId={owner.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1 text-foreground">{value || "—"}</div>
    </div>
  );
}

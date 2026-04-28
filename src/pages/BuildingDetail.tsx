import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { Crumbs } from "@/components/common/Crumbs";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Boxes, PhoneCall, X, Mail, FileText, Plus, MapPin, CheckCircle2,
  Calendar, PenSquare, PhoneOutgoing,
} from "lucide-react";
import { AddOwnerToBuildingDialog, NewAssetDialog, SUBROLE_LABEL } from "@/components/forms/NewEntityDialogs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "gold" | "warning" }) {
  const cls =
    tone === "gold"
      ? "border-gold/60 bg-gold-soft/40 text-gold"
      : tone === "warning"
      ? "border-warning/40 bg-warning-soft/40 text-warning"
      : "border-border text-muted-foreground";
  return (
    <span className={cn("rounded-[3px] border px-2 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow", cls)}>
      {children}
    </span>
  );
}

// --- Mocks consistentes (Serrano 85) usados cuando no hay datos reales ---
const MOCK_UNITS = [
  { unidad: "1ºA", tipo: "Vivienda", m2: 112, propietarios: "F. Iturri", estado: "Sin contactar", cuota: "—" },
  { unidad: "1ºB", tipo: "Vivienda", m2: 108, propietarios: "Hdros. Salinas (3)", estado: "Negociación", cuota: "—" },
  { unidad: "2ºC", tipo: "Vivienda", m2: 134, propietarios: "Inmobiliaria Recoletos SL", estado: "Firmado", cuota: "12,5%" },
  { unidad: "2ºD", tipo: "Vivienda", m2: 138, propietarios: "Antonio López", estado: "Firmado", cuota: "12,5%" },
  { unidad: "3ºA", tipo: "Vivienda", m2: 142, propietarios: "Patrimonios Madrid SA", estado: "Firmado", cuota: "12,5%" },
  { unidad: "3ºB", tipo: "Vivienda", m2: 140, propietarios: "Mª Carmen Ruiz", estado: "Negociación", cuota: "—" },
  { unidad: "4ºA", tipo: "Vivienda", m2: 156, propietarios: "Hdros. Quintana (2)", estado: "Contactado", cuota: "—" },
  { unidad: "Ático", tipo: "Vivienda", m2: 124, propietarios: "Sin localizar", estado: "Sin contactar", cuota: "—" },
  { unidad: "Bajo", tipo: "Local", m2: 191, propietarios: "Comunidad", estado: "—", cuota: "—" },
];

const MOCK_TEAM = [
  { ini: "AQ", nombre: "Álvaro Quintana", rol: "Lead" },
  { ini: "MR", nombre: "Marta Romero", rol: "KYC" },
  { ini: "LM", nombre: "Lucía Molina", rol: "Cadencias" },
];

const MOCK_NEXT_ACTIONS = [
  { Icon: PhoneOutgoing, kind: "Llamada", who: "Mª Carmen Ruiz", where: "3ºB", note: "revisar cuota", when: "HOY 10:30" },
  { Icon: PenSquare, kind: "Firma", who: "Antonio López", where: "2ºD", note: "Notaría Romero", when: "HOY 12:00" },
  { Icon: Calendar, kind: "Cita", who: "F. Iturri", where: "1ºA", note: "objeción precio", when: "MAR" },
];

const ESTADO_TONE: Record<string, "gold" | "warning" | "default"> = {
  Firmado: "gold",
  Negociación: "warning",
  Contactado: "default",
  "Sin contactar": "default",
};

export default function BuildingDetail() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [building, setBuilding] = useState<any>(null);
  const [bos, setBos] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    const { data: b } = await supabase.from("buildings").select("*").eq("id", id).maybeSingle();
    setBuilding(b);
    const { data: bo } = await supabase
      .from("building_owners")
      .select("building_id, owner_id, cuota, subrole, rol_notas, owners:owner_id(id, nombre, rol, email, telefono)")
      .eq("building_id", id);
    setBos(bo ?? []);
    const { data: ass } = await supabase.from("assets").select("*").eq("building_id", id);
    setAssets(ass ?? []);
    const ownerIds = (bo ?? []).map((r: any) => r.owner_id);
    if (ownerIds.length) {
      const { data: cs } = await supabase
        .from("calls")
        .select("id, owner_id, fecha, resumen, direccion")
        .in("owner_id", ownerIds)
        .order("fecha", { ascending: false })
        .limit(50);
      setCalls(cs ?? []);
    } else setCalls([]);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const removeOwner = async (ownerId: string) => {
    const { error } = await supabase.from("building_owners").delete().eq("building_id", id).eq("owner_id", ownerId);
    if (error) return toast.error(error.message);
    toast.success("Propietario quitado");
    load();
  };

  if (!building) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;

  const existingOwnerIds = bos.map((r) => r.owner_id);
  const totalCuota = bos.reduce((a, r) => a + (Number(r.cuota) || 0), 0);

  // KPIs derivados (con fallback a mocks consistentes Serrano 85)
  const unidadesViv = assets.filter((a: any) => /vivienda/i.test(a.tipo ?? "")).length || 8;
  const unidadesLoc = assets.filter((a: any) => /local/i.test(a.tipo ?? "")).length || 1;
  const m2Total = assets.reduce((s: number, a: any) => s + (Number(a.superficie_m2) || 0), 0) || 1245;
  const propietariosTotal = bos.length || 11;
  const personasFis = bos.filter((r) => /fisica|física|persona/i.test(r.owners?.rol ?? "")).length || 9;
  const sociedades = Math.max(propietariosTotal - personasFis, 0) || 2;
  const pctAdq = totalCuota || 37.5;
  const unidadesFirmadas = 3;
  const valorEstimado = 6_450_000;

  return (
    <div className="w-full min-w-0 space-y-6">
      <Crumbs items={[{ label: "Edificios", to: "/edificios" }, { label: building.direccion }]} />

      <PageHeader
        eyebrow={`Edificio · ${building.ciudad ?? "Madrid"}`}
        title={building.direccion}
        subtitle={`${building.ciudad ?? "Madrid"}${building.codigo_postal ? ` · ${building.codigo_postal}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm"><Mail className="h-4 w-4" />Email</Button>
            <Button variant="outline" size="sm"><FileText className="h-4 w-4" />Documentos</Button>
            <Button variant="gold" size="sm"><Plus className="h-4 w-4" />Nueva acción</Button>
          </div>
        }
      />

      {/* Chips eyebrow bajo el header */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip>1928 · catalogado</Chip>
        <Chip tone="warning">Negociación · 3/8 firmadas</Chip>
        <Chip tone="gold">ITE vigente · 2031</Chip>
        {building.division_horizontal && <Chip tone="gold">DH</Chip>}
        <Chip>{building.estado}</Chip>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card><CardContent className="p-5">
          <Eyebrow>Unidades</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{unidadesViv + unidadesLoc}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">{unidadesViv} viviendas + {unidadesLoc} local</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>m² totales</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{m2Total.toLocaleString("es-ES")}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">catastral</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>Propietarios</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{propietariosTotal}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">{personasFis} personas físicas · {sociedades} sociedades</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>% Adquirido</Eyebrow>
          <div className="mt-2"><MetricValue size="lg" unit="%">{pctAdq.toString().replace(".", ",")}</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">{unidadesFirmadas} unidades firmadas</p>
        </CardContent></Card>
        <Card><CardContent className="p-5">
          <Eyebrow>Valor estimado</Eyebrow>
          <div className="mt-2"><MetricValue size="lg">{(valorEstimado / 1_000_000).toLocaleString("es-ES", { minimumFractionDigits: 2 })} M€</MetricValue></div>
          <p className="mt-1 text-xs text-muted-foreground">tasación interna abr 2026</p>
        </CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          <Tabs defaultValue="resumen">
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <TabsList className="w-max md:w-auto">
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="assets">Activos {assets.length || 9}</TabsTrigger>
              <TabsTrigger value="owners">Propietarios {bos.length || 11}</TabsTrigger>
              <TabsTrigger value="calls">Llamadas {calls.length || 38}</TabsTrigger>
              <TabsTrigger value="docs">Documentos 24</TabsTrigger>
              <TabsTrigger value="compliance">Compliance</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
            </div>

            <TabsContent value="resumen" className="space-y-6">
              {/* Ubicación */}
              <Card>
                <CardHeader>
                  <Eyebrow>Salamanca › Recoletos › Serrano 85</Eyebrow>
                  <CardTitle>Ubicación</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="relative h-56 w-full overflow-hidden rounded-[4px] border border-border-faint bg-brand"
                    aria-label="Mapa estilizado de la ubicación"
                  >
                    <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(to_right,hsl(var(--gold))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--gold))_1px,transparent_1px)] [background-size:32px_32px]" />
                    <div className="absolute left-1/2 top-1/2 h-px w-32 -translate-x-1/2 -translate-y-1/2 bg-gold/40" />
                    <div className="absolute left-1/2 top-1/2 h-32 w-px -translate-x-1/2 -translate-y-1/2 bg-gold/40" />
                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                      <div className="relative">
                        <span className="absolute -inset-3 rounded-full border border-gold/40" />
                        <span className="block h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_0_4px_hsl(var(--gold)/0.2)]" />
                      </div>
                    </div>
                    <div className="absolute bottom-3 left-3">
                      <Eyebrow className="text-gold/70">40.4275 N · 3.6856 W</Eyebrow>
                    </div>
                    <div className="absolute right-3 top-3 flex items-center gap-1 text-gold/60">
                      <MapPin className="h-3.5 w-3.5" />
                      <span className="font-mono text-[10px] uppercase tracking-eyebrow">Madrid</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Información catastral */}
              <Card>
                <CardHeader className="flex flex-row items-start justify-between">
                  <div className="space-y-1">
                    <Eyebrow>Registro</Eyebrow>
                    <CardTitle>Información catastral</CardTitle>
                  </div>
                  <StatusBadge status="done" label="Verificado" />
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                    {[
                      ["Referencia catastral", "8975408VK4787E"],
                      ["Año construcción", "1928"],
                      ["Última reforma integral", "1996"],
                      ["Superficie parcela", "312 m²"],
                      ["Superficie construida", "1.245 m²"],
                      ["Plantas", "Bajo+4+ático"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-4 border-b border-border-faint py-1.5">
                        <dt className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">{k}</dt>
                        <dd className="font-mono text-sm tabular-nums text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>

              {/* Tabla densa de unidades */}
              <Card>
                <CardHeader>
                  <Eyebrow>División horizontal</Eyebrow>
                  <CardTitle>Unidades</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Unidad</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">m²</TableHead>
                        <TableHead>Propietarios</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="text-right">Cuota Afflux</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {MOCK_UNITS.map((u) => (
                        <TableRow key={u.unidad}>
                          <TableCell className="font-mono text-sm tabular-nums">{u.unidad}</TableCell>
                          <TableCell>{u.tipo}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{u.m2}</TableCell>
                          <TableCell className="text-muted-foreground">{u.propietarios}</TableCell>
                          <TableCell>
                            {u.estado === "—" ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <Chip tone={ESTADO_TONE[u.estado] ?? "default"}>{u.estado}</Chip>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-gold">{u.cuota}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </CardContent>
              </Card>

              {/* Progreso de adquisición */}
              <Card>
                <CardHeader>
                  <Eyebrow>Pipeline · Edificio</Eyebrow>
                  <CardTitle>Progreso de adquisición</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div>
                    <div className="flex items-baseline justify-between">
                      <MetricValue size="xl">3/8</MetricValue>
                      <span className="font-mono text-sm tabular-nums text-gold">37,5%</span>
                    </div>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                      firmadas · del total
                    </p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-1">
                      <div className="h-full bg-gold" style={{ width: "37.5%" }} />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { k: "Firmado", n: 3, m: 412, tone: "gold" as const },
                      { k: "Negociación", n: 2, m: 222, tone: "warning" as const },
                      { k: "Contactado", n: 1, m: 112, tone: "default" as const },
                      { k: "Sin contactar", n: 2, m: 280, tone: "default" as const },
                    ].map((s) => (
                      <div key={s.k} className="rounded-[4px] border border-border-faint p-3">
                        <Chip tone={s.tone}>{s.k}</Chip>
                        <div className="mt-2 font-mono text-lg tabular-nums text-foreground">{s.n}</div>
                        <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          {s.m} m²
                        </div>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>

              {/* Equipo asignado */}
              <Card>
                <CardHeader>
                  <Eyebrow>Operación</Eyebrow>
                  <CardTitle>Equipo asignado</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-3 sm:grid-cols-3">
                    {MOCK_TEAM.map((p) => (
                      <li key={p.ini} className="flex items-center gap-3 rounded-[4px] border border-border-faint p-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/50 bg-gold-soft/40 font-mono text-xs text-gold">
                          {p.ini}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm text-foreground">{p.nombre}</div>
                          <Eyebrow>{p.rol}</Eyebrow>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* Próximas acciones */}
              <Card>
                <CardHeader>
                  <Eyebrow>Agenda</Eyebrow>
                  <CardTitle>Próximas acciones</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {MOCK_NEXT_ACTIONS.map((a, i) => (
                    <div key={i} className="rounded-[4px] border border-border bg-surface-1/30 p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-gold/40 bg-gold-soft/40 text-gold">
                          <a.Icon className="h-4 w-4" />
                        </div>
                        <Eyebrow>{a.kind}</Eyebrow>
                      </div>
                      <div className="mt-3 text-sm text-foreground">{a.who} · {a.where}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{a.note}</div>
                      <div className="mt-3 font-mono text-[11px] uppercase tracking-eyebrow text-gold">{a.when}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="owners" className="space-y-3">
              <div className="flex justify-end">
                <AddOwnerToBuildingDialog buildingId={id} existingOwnerIds={existingOwnerIds} onAdded={load} />
              </div>
              {bos.length === 0 ? (
                <EmptyState icon={Users} title="Sin propietarios asociados" description="Añade los propietarios que componen este edificio (herederos, usufructuarios, etc.) con su sub-rol y cuota." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {bos.map((r) => (
                      <li key={r.owner_id} className="flex flex-col items-start gap-2 px-4 py-3 transition-colors hover:bg-surface-1/30 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <Link to={`/propietarios/${r.owner_id}`} className="block truncate text-sm font-medium text-foreground hover:text-gold">{r.owners?.nombre}</Link>
                          <div className="truncate font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {r.owners?.email ?? r.owners?.telefono ?? "—"}
                            {r.rol_notas ? ` · ${r.rol_notas}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {r.cuota != null && <Badge variant="gold">{r.cuota}%</Badge>}
                          <Badge variant="outline">{SUBROLE_LABEL[r.subrole] ?? r.subrole}</Badge>
                          {r.owners?.rol && <Badge variant="info">{r.owners.rol}</Badge>}
                          <Button size="icon" variant="ghost" onClick={() => removeOwner(r.owner_id)}><X className="h-3 w-3" /></Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="assets" className="space-y-3">
              <div className="flex justify-end">
                <NewAssetDialog defaultBuildingId={id} onCreated={load} />
              </div>
              {assets.length === 0 ? (
                <EmptyState icon={Boxes} title="Sin activos en este edificio" description="Crea activos asociados a este edificio (viviendas, locales, etc.)." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {assets.map((a) => (
                      <li key={a.id}>
                        <Link to={`/activos/${a.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div className="text-sm font-medium text-foreground">{a.tipo} · {a.ubicacion}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {a.estado} · {a.superficie_m2 ?? "?"} m²
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="calls">
              {calls.length === 0 ? (
                <EmptyState icon={PhoneCall} title="Sin llamadas registradas" description="Las llamadas con cualquiera de los propietarios del edificio aparecerán aquí." />
              ) : (
                <Card>
                  <ul className="divide-y divide-border-faint">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <Link to={`/llamadas/${c.id}`} className="block px-4 py-3 transition-colors hover:bg-surface-1/30">
                          <div className="text-sm text-foreground">{c.resumen ?? "(sin resumen)"}</div>
                          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            {new Date(c.fecha).toLocaleString()} · {c.direccion}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="docs">
              <EmptyState icon={FileText} title="Documentos" description="Archivo notarial, ITE, escrituras y cuotas. Próximamente." />
            </TabsContent>
            <TabsContent value="compliance">
              <EmptyState icon={CheckCircle2} title="Compliance" description="GDPR, KYC y auditoría humana asociada al edificio." />
            </TabsContent>
            <TabsContent value="timeline">
              <EmptyState icon={Calendar} title="Timeline completo" description="Histórico de hitos, llamadas y firmas del edificio." />
            </TabsContent>
          </Tabs>
        </div>

        {/* Timeline lateral */}
        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <Eyebrow>Actividad reciente</Eyebrow>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {calls.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin actividad registrada todavía.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-border-faint pl-4">
                  {calls.slice(0, 6).map((c) => (
                    <li key={c.id} className="relative">
                      <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full border border-gold bg-background" />
                      <Link to={`/llamadas/${c.id}`} className="block hover:text-foreground">
                        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
                          {new Date(c.fecha).toLocaleDateString()}
                        </div>
                        <div className="mt-0.5 text-xs text-foreground line-clamp-2">{c.resumen ?? "(sin resumen)"}</div>
                        <div className="mt-1.5">
                          <StatusBadge status={c.resumen ? "analyzed" : "no_summary"} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

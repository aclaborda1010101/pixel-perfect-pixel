import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, Loader2, ShieldAlert, Check, EyeOff } from "lucide-react";
import { toast } from "sonner";

type Proposal = {
  id: string;
  guarda: number;
  entity_type: string;
  entity_id: string;
  edificio_id: string | null;
  titulo: string;
  detalle: string | null;
  propuesta: any;
  estado: string;
  creado_at: string;
};

const GUARDAS: { n: number; label: string; desc: string }[] = [
  { n: 1, label: "G1 · Estado de ciclo", desc: "Contactos con llamada real cuyo estado sigue sin contactar. Propuesta: marcar «Contactado» en HubSpot." },
  { n: 2, label: "G2 · % sin cargar", desc: "Edificios con menos del 50% de titulares con cuota cargada." },
  { n: 4, label: "G4 · Titular sin tarea", desc: "Titulares con cuota y sin próxima acción ni tarea abierta en HubSpot." },
  { n: 6, label: "G6 · Operación viva", desc: "Edificios con llamada en los últimos 60 días y sin próxima acción." },
];

const PAGE_SIZE = 200;

export default function AdminGuardas() {
  const { user } = useAuth();
  const { role, loading: roleLoading } = useCurrentRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState("1");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [working, setWorking] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const permitido = role === "admin" || (user?.email ?? "").toLowerCase() === "jesus.anzola@afflux.es";

  const counts = useQuery({
    queryKey: ["guardas_counts"],
    queryFn: async () => {
      const out: Record<number, number> = {};
      await Promise.all(
        GUARDAS.map(async (g) => {
          const { count } = await (supabase.from("guard_proposals" as any) as any)
            .select("id", { count: "exact", head: true })
            .eq("guarda", g.n).eq("estado", "pendiente");
          out[g.n] = count ?? 0;
        }),
      );
      return out;
    },
    enabled: permitido,
  });

  const guarda = Number(tab);
  const lista = useQuery({
    queryKey: ["guardas_lista", guarda],
    enabled: permitido,
    queryFn: async (): Promise<Proposal[]> => {
      const { data, error } = await (supabase.from("guard_proposals" as any) as any)
        .select("*")
        .eq("guarda", guarda)
        .eq("estado", "pendiente")
        .order("creado_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as Proposal[];
    },
  });

  const rows = lista.data ?? [];
  const seleccionadas = useMemo(() => rows.filter((r) => sel[r.id]).map((r) => r.id), [rows, sel]);
  const todoSeleccionado = rows.length > 0 && seleccionadas.length === rows.length;

  if (roleLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  if (!permitido) return <Navigate to="/" replace />;

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["guardas_lista"] });
    qc.invalidateQueries({ queryKey: ["guardas_counts"] });
  };

  const detectar = async () => {
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("guardas_detect", { body: {} });
      if (error) throw error;
      toast.success("Detección ejecutada", { description: JSON.stringify((data as any)?.nuevas ?? {}) });
      refrescar();
    } catch (e: any) {
      toast.error("No se pudo ejecutar la detección", { description: e?.message });
    } finally {
      setDetecting(false);
    }
  };

  const resolver = async (accion: "aprobar" | "rechazar", ids: string[]) => {
    if (!ids.length) { toast.error("Selecciona al menos una propuesta"); return; }
    setWorking(true);
    try {
      const { data, error } = await supabase.functions.invoke("guardas_aprobar", { body: { accion, ids } });
      if (error) throw error;
      const d = data as any;
      toast.success(
        accion === "aprobar" ? "Propuestas aprobadas" : "Propuestas marcadas como vistas",
        { description: `${d?.marcados ?? 0} resueltas · ${d?.escritos_hubspot ?? 0} escrituras en HubSpot · ${d?.fallidos ?? 0} fallos` },
      );
      setSel({});
      refrescar();
    } catch (e: any) {
      toast.error("Error resolviendo propuestas", { description: e?.message });
    } finally {
      setWorking(false);
    }
  };

  const meta = GUARDAS.find((g) => g.n === guarda)!;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Admin · Orquestador"
        title="Guardas (modo aviso)"
        subtitle="Propuestas detectadas automáticamente. Nada se escribe sin aprobación explícita."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={detectar} disabled={detecting}>
              {detecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Detectar ahora
            </Button>
            <Button variant="outline" size="sm" onClick={refrescar} disabled={lista.isFetching}>
              <RefreshCw className={`h-4 w-4 ${lista.isFetching ? "animate-spin" : ""}`} />
              Refrescar
            </Button>
          </div>
        }
      />

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setSel({}); }} className="space-y-4">
        <TabsList>
          {GUARDAS.map((g) => (
            <TabsTrigger key={g.n} value={String(g.n)}>
              {g.label}
              <Badge variant="secondary" className="ml-2 font-mono tabular-nums">
                {counts.data?.[g.n] ?? 0}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        {GUARDAS.map((g) => (
          <TabsContent key={g.n} value={String(g.n)} className="space-y-4">
            <p className="text-sm text-muted-foreground">{meta.desc}</p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={todoSeleccionado}
                  onCheckedChange={(v) => {
                    const marcar = v === true;
                    const next: Record<string, boolean> = {};
                    if (marcar) rows.forEach((r) => { next[r.id] = true; });
                    setSel(next);
                  }}
                />
                Seleccionar todo ({rows.length})
              </label>
              <span className="font-mono text-xs text-muted-foreground">{seleccionadas.length} seleccionadas</span>
              {g.n === 1 && (
                <Button size="sm" disabled={working || !seleccionadas.length} onClick={() => resolver("aprobar", seleccionadas)}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aprobar seleccionadas
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={working || !seleccionadas.length}
                onClick={() => resolver("rechazar", seleccionadas)}>
                <EyeOff className="h-4 w-4" />
                {g.n === 1 ? "Rechazar seleccionadas" : "Marcar vistas"}
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                      <Checkbox
                        className="mt-1"
                        checked={!!sel[r.id]}
                        onCheckedChange={(v) => setSel((s) => ({ ...s, [r.id]: v === true }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{r.titulo}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{r.detalle}</div>
                        {g.n === 1 && (
                          <div className="mt-1 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                            Propuesta: {r.propuesta?.campo} = «{r.propuesta?.valor}»
                          </div>
                        )}
                      </div>
                      {g.n === 1 && (
                        <Button size="sm" variant="ghost" disabled={working} onClick={() => resolver("aprobar", [r.id])}>
                          <Check className="h-3.5 w-3.5" /> Aprobar
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" disabled={working} onClick={() => resolver("rechazar", [r.id])}>
                        <EyeOff className="h-3.5 w-3.5" /> {g.n === 1 ? "Rechazar" : "Vista"}
                      </Button>
                    </div>
                  ))}
                  {!rows.length && !lista.isFetching && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Sin propuestas pendientes.</div>
                  )}
                  {lista.isFetching && !rows.length && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Cargando…</div>
                  )}
                </div>
              </CardContent>
            </Card>
            {rows.length >= PAGE_SIZE && (
              <p className="text-xs text-muted-foreground">
                Mostrando las {PAGE_SIZE} más recientes de {counts.data?.[g.n] ?? 0} pendientes.
              </p>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, RefreshCw, Copy } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

type Row = { orden: number; metrica: string; valor: string; ok: boolean | null; detalle: string };
type RevRow = {
  distrito: string | null;
  nombre: string | null;
  apellidos: string | null;
  telefono: string | null;
  match_metodo: string | null;
};

export default function AdminIntegridad() {
  const { role, loading: roleLoading } = useCurrentRole();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [rev, setRev] = useState<{
    total: number;
    macheados: number;
    ambiguos: number;
    sin_match: number;
    segmento_a: number;
    segmento_b: number;
    revision: RevRow[];
  } | null>(null);
  const [revLoading, setRevLoading] = useState(false);
  const [guardas, setGuardas] = useState<Record<number, number> | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("v_integridad_datos" as any)
      .select("*").order("orden", { ascending: true });
    if (!error && data) setRows(data as any);
    setLoading(false);
    setRefreshedAt(new Date());
  };

  const loadGuardas = async () => {
    const nums = [1, 2, 4, 6];
    const res = await Promise.all(
      nums.map((n) =>
        (supabase.from("guard_proposals" as any) as any)
          .select("id", { count: "exact", head: true })
          .eq("guarda", n).eq("estado", "pendiente"),
      ),
    );
    const out: Record<number, number> = {};
    nums.forEach((n, i) => { out[n] = (res[i] as any).count ?? 0; });
    setGuardas(out);
  };

  const loadRev = async () => {
    setRevLoading(true);
    const table = (supabase.from("campana_revista_2026" as any) as any);
    const [{ count: total }, { count: macheados }, { count: ambiguos }, { count: sinMatch }, { count: segA }, { count: segB }, { data: revision }] = await Promise.all([
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }),
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }).not("owner_id", "is", null),
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }).eq("match_metodo", "ambiguo"),
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }).is("match_metodo", null),
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }).not("telefono", "is", null).neq("telefono", ""),
      (supabase.from("campana_revista_2026" as any) as any).select("*", { count: "exact", head: true }).or("telefono.is.null,telefono.eq."),
      (supabase.from("campana_revista_2026" as any) as any)
        .select("distrito, nombre, apellidos, telefono, match_metodo")
        .or("match_metodo.eq.ambiguo,match_metodo.is.null")
        .order("distrito", { ascending: true })
        .limit(500),
    ]);
    setRev({
      total: total ?? 0,
      macheados: macheados ?? 0,
      ambiguos: ambiguos ?? 0,
      sin_match: sinMatch ?? 0,
      segmento_a: segA ?? 0,
      segmento_b: segB ?? 0,
      revision: (revision ?? []) as any,
    });
    setRevLoading(false);
  };

  useEffect(() => { load(); loadRev(); loadGuardas(); }, []);

  if (roleLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  if (role !== "admin") return <Navigate to="/" replace />;

  const okCount = rows.filter((r) => r.ok === true).length;
  const koCount = rows.filter((r) => r.ok === false).length;

  const copyRow = (r: RevRow) => {
    const line = [r.distrito, r.nombre, r.apellidos, r.telefono].filter(Boolean).join(" · ");
    navigator.clipboard.writeText(line).then(
      () => toast.success("Copiado"),
      () => toast.error("No se pudo copiar"),
    );
  };

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Admin · Salud de datos"
        title="Integridad de datos"
        subtitle="Semáforos globales: sync, vínculos propietario↔edificio, transcripciones, notas simples"
        actions={
          <Button variant="outline" size="sm" onClick={() => { load(); loadRev(); loadGuardas(); }} disabled={loading || revLoading}>
            <RefreshCw className={`h-4 w-4 ${loading || revLoading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        }
      />

      <Tabs defaultValue="semaforos" className="space-y-4">
        <TabsList>
          <TabsTrigger value="semaforos">Semáforos</TabsTrigger>
          <TabsTrigger value="revista">Campaña revista</TabsTrigger>
        </TabsList>

        <TabsContent value="semaforos" className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-[4px] border border-success/40 bg-success-soft/40 px-2 py-1 text-success">{okCount} OK</span>
        <span className="rounded-[4px] border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive">{koCount} en rojo</span>
        {refreshedAt && (
          <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
            Última lectura: {refreshedAt.toLocaleTimeString("es-ES")}
          </span>
        )}
          </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5 shrink-0">
                {guardas && Object.values(guardas).some((v) => v > 0) ? (
                  <AlertCircle className="h-5 w-5 text-warning" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-foreground">Guardas del orquestador · propuestas pendientes</div>
                  <div className="font-mono text-sm tabular-nums text-foreground">
                    {guardas ? Object.values(guardas).reduce((a, b) => a + b, 0).toLocaleString("es-ES") : "—"}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {guardas
                    ? `G1 ${guardas[1]} · G2 ${guardas[2]} · G4 ${guardas[4]} · G6 ${guardas[6]} — revisar en /admin/guardas`
                    : "Cargando…"}
                </div>
              </div>
            </div>
            {rows.map((r) => (
              <div key={r.orden} className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 shrink-0">
                  {r.ok === true ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : r.ok === false ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <span className="inline-block h-5 w-5 rounded-full border border-muted-foreground/40" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{r.metrica}</div>
                    <div className="font-mono text-sm tabular-nums text-foreground">{r.valor}</div>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.detalle}</div>
                </div>
              </div>
            ))}
            {!rows.length && !loading && (
              <div className="p-6 text-center text-sm text-muted-foreground">Sin datos.</div>
            )}
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="revista" className="space-y-4">
          {!rev ? (
            <div className="text-sm text-muted-foreground">Cargando campaña…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                <StatCard label="Total campaña" value={rev.total} />
                <StatCard label="Macheados" value={rev.macheados} tone="ok" />
                <StatCard label="Ambiguos" value={rev.ambiguos} tone="warn" />
                <StatCard label="Sin match" value={rev.sin_match} tone="err" />
                <StatCard label="Seg. A · contactable" value={rev.segmento_a} tone="ok" />
                <StatCard label="Seg. B · sin teléfono" value={rev.segmento_b} tone="warn" />
              </div>
              <Card>
                <CardContent className="p-0">
                  <div className="border-b border-border px-4 py-3">
                    <div className="text-sm font-medium text-foreground">
                      Revisión humana · {rev.revision.length} registros
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ambiguos ({rev.ambiguos}) y sin match ({rev.sin_match}) para asignación manual.
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {rev.revision.map((r, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                        <div className="w-24 shrink-0 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                          {r.distrito ?? "—"}
                        </div>
                        <div className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{r.nombre ?? ""}</span>{" "}
                          <span className="text-muted-foreground">{r.apellidos ?? ""}</span>
                        </div>
                        <div className="w-32 shrink-0 font-mono text-xs text-muted-foreground">
                          {r.telefono || "sin tel."}
                        </div>
                        <div className="w-20 shrink-0">
                          <span
                            className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow ${
                              r.match_metodo === "ambiguo"
                                ? "border-warning/40 bg-warning-soft/40 text-warning"
                                : "border-destructive/40 bg-destructive/10 text-destructive"
                            }`}
                          >
                            {r.match_metodo ?? "sin match"}
                          </span>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => copyRow(r)}>
                          <Copy className="h-3.5 w-3.5" /> Copiar
                        </Button>
                      </div>
                    ))}
                    {rev.revision.length === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">Sin registros para revisar.</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "err";
}) {
  const cls =
    tone === "ok"
      ? "border-success/40 bg-success-soft/30 text-success"
      : tone === "warn"
      ? "border-warning/40 bg-warning-soft/30 text-warning"
      : tone === "err"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-border bg-surface-1/40 text-foreground";
  return (
    <div className={`rounded-[6px] border px-3 py-2 ${cls}`}>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow opacity-80">{label}</div>
      <div className="font-mono text-lg tabular-nums">{value.toLocaleString("es-ES")}</div>
    </div>
  );
}
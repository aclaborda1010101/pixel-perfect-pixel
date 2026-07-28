import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { Navigate } from "react-router-dom";

type Row = { orden: number; metrica: string; valor: string; ok: boolean | null; detalle: string };

export default function AdminIntegridad() {
  const { role, loading: roleLoading } = useCurrentRole();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("v_integridad_datos" as any)
      .select("*").order("orden", { ascending: true });
    if (!error && data) setRows(data as any);
    setLoading(false);
    setRefreshedAt(new Date());
  };

  useEffect(() => { load(); }, []);

  if (roleLoading) return <div className="text-sm text-muted-foreground">Cargando…</div>;
  if (role !== "admin") return <Navigate to="/" replace />;

  const okCount = rows.filter((r) => r.ok === true).length;
  const koCount = rows.filter((r) => r.ok === false).length;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="Admin · Salud de datos"
        title="Integridad de datos"
        subtitle="Semáforos globales: sync, vínculos propietario↔edificio, transcripciones, notas simples"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        }
      />

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
    </div>
  );
}
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { upsertGroundTruth } from "@/lib/qaGroundTruth";
import { toast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldX, ExternalLink } from "lucide-react";

type Row = {
  id: string;
  building_id: string;
  direccion: string | null;
  rc14: string | null;
  estado: string;
  capa: string | null;
  nivel_proteccion: string | null;
  n_catalogo: string | null;
  validado_resultado: boolean | null;
  validado_at: string | null;
  nota: string | null;
};

export default function ProteccionValidationQueuePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<"pendientes" | "todas">("pendientes");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    let q = supabase
      .from("proteccion_validation_queue")
      .select("*")
      .order("detectado_en", { ascending: false })
      .limit(500);
    if (filter === "pendientes") q = q.is("validado_at", null);
    const { data, error } = await q;
    if (error) toast({ title: "Error", description: error.message });
    setRows((data as Row[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function validar(row: Row, esProtegido: boolean) {
    // 1) marca cola
    const { error: e1 } = await supabase
      .from("proteccion_validation_queue")
      .update({
        validado_por: user?.id ?? null,
        validado_at: new Date().toISOString(),
        validado_resultado: esProtegido,
      })
      .eq("id", row.id);
    if (e1) return toast({ title: "Error", description: e1.message });

    // 2) escribe building_analysis (override humano)
    const { error: e2 } = await supabase
      .from("building_analysis")
      .upsert(
        {
          building_id: row.building_id,
          protegido_historicamente: esProtegido,
          proteccion_source: esProtegido ? row.capa ?? "humano" : "humano_no_protegido",
        } as any,
        { onConflict: "building_id" },
      );
    if (e2) return toast({ title: "Error", description: e2.message });

    // 3) escribe qa_ground_truth
    await upsertGroundTruth({
      buildingId: row.building_id,
      dimension: "proteccion",
      valorHumano: esProtegido,
      fuente: "verificacion_inline",
      verificadoPor: user?.id ?? null,
    });

    toast({ title: esProtegido ? "Marcado protegido" : "Marcado NO protegido" });
    load();
  }

  const pendientes = rows.filter((r) => !r.validado_at).length;
  const validadas = rows.filter((r) => r.validado_at).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Validación PGOUM"
        description="Confirma o corrige los hits de protección urbanística. Se escribe a qa_ground_truth."
      />
      <div className="flex gap-2">
        <Button size="sm" variant={filter === "pendientes" ? "default" : "outline"} onClick={() => setFilter("pendientes")}>
          Pendientes ({pendientes})
        </Button>
        <Button size="sm" variant={filter === "todas" ? "default" : "outline"} onClick={() => setFilter("todas")}>
          Todas
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">Validadas mostradas: {validadas}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cola ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin entradas.</p>
          ) : (
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex-1 min-w-[220px]">
                    <Link
                      to={`/comercial/edificios/${r.building_id}`}
                      className="flex items-center gap-1 font-medium hover:underline"
                    >
                      {r.direccion ?? r.rc14 ?? r.building_id}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      RC14 {r.rc14 ?? "—"} · {r.capa ?? "sin capa"} · nivel {r.nivel_proteccion ?? "—"}
                      {r.n_catalogo && <> · cat {r.n_catalogo}</>}
                    </div>
                  </div>
                  <Badge
                    variant={
                      r.estado === "hit_pgou"
                        ? "warning"
                        : r.estado === "marcado_pero_miss"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {r.estado}
                  </Badge>
                  {r.validado_at ? (
                    <Badge variant={r.validado_resultado ? "success" : "outline"}>
                      {r.validado_resultado ? "Protegido ✓" : "No protegido ✓"}
                    </Badge>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="default" onClick={() => validar(r, true)}>
                        <ShieldCheck className="mr-1 h-3 w-3" /> Sí, protegido
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => validar(r, false)}>
                        <ShieldX className="mr-1 h-3 w-3" /> No protegido
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
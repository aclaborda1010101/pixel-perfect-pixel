import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight, Loader2, PlayCircle, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import {
  cabeceraCoherencia,
  evolucion,
  tendencia,
  saludBase,
  type ResumenCoherencia,
} from "@/lib/coherencia";

type Caso = { building_id: string | null; detalle: string | null };

export function RevisionCoherencia() {
  const qc = useQueryClient();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [working, setWorking] = useState(false);

  const resumen = useQuery({
    queryKey: ["coherencia-resumen"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("coherencia_resumen");
      if (error) throw new Error(error.message);
      return (data ?? {}) as ResumenCoherencia;
    },
  });

  const casos = useQuery({
    queryKey: ["coherencia-casos", abierta],
    enabled: !!abierta,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("coherencia_casos", {
        p_codigo: abierta,
        p_limite: 100,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as Caso[];
    },
  });

  const reglas = resumen.data?.reglas ?? [];
  const cab = cabeceraCoherencia(reglas);
  const salud = saludBase(cab.total);

  const ejecutar = async () => {
    setWorking(true);
    try {
      const { error } = await (supabase.rpc as any)("coherencia_evaluar");
      if (error) throw new Error(error.message);
      toast.success("Revisión ejecutada");
      qc.invalidateQueries({ queryKey: ["coherencia-resumen"] });
    } catch (e: any) {
      toast.error("No se pudo ejecutar", { description: e?.message });
    } finally {
      setWorking(false);
    }
  };

  const aceptar = async (codigo: string, aceptada: boolean) => {
    try {
      const { error } = await (supabase.rpc as any)("coherencia_aceptar_regla", {
        p_codigo: codigo,
        p_aceptada: aceptada,
        p_motivo: aceptada ? motivo.trim() : null,
      });
      if (error) throw new Error(error.message);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["coherencia-resumen"] });
      toast.success(aceptada ? "Regla aceptada a propósito" : "Regla vuelve a vigilarse");
    } catch (e: any) {
      toast.error("No se pudo guardar", { description: e?.message });
    }
  };

  if (resumen.isLoading) return <div className="text-sm text-muted-foreground">Cargando revisión…</div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div>
            <div className="text-2xl font-semibold tabular-nums">{cab.total.toLocaleString("es-ES")}</div>
            <div className="text-xs text-muted-foreground">casos que incumplen alguna regla</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {cab.enCero}/{reglas.length}
            </div>
            <div className="text-xs text-muted-foreground">reglas sin ningún incumplimiento</div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="text-xs text-muted-foreground">Las tres que más casos tienen</div>
            <div className="text-sm">
              {cab.peores.length === 0
                ? "Ninguna"
                : cab.peores.map((r) => `${r.nombre} (${r.n_casos})`).join(" · ")}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{salud.texto}</span>
            <Button size="sm" variant="outline" onClick={ejecutar} disabled={working}>
              {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              Ejecutar ahora
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Se revisa sola cada noche a las 03:15 y guarda el histórico.
        {resumen.data?.medido_at
          ? ` Última medición: ${new Date(resumen.data.medido_at).toLocaleString("es-ES")}.`
          : ""}
      </p>

      <div className="rounded-md border">
        {reglas.map((r) => {
          const t = tendencia(r.historico);
          const abierto = abierta === r.codigo;
          return (
            <div key={r.codigo} className="border-b last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button
                  className="flex flex-1 items-start gap-2 text-left"
                  onClick={() => setAbierta(abierto ? null : r.codigo)}
                >
                  {abierto ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span>
                    <span className="font-medium">{r.nombre}</span>
                    <span className="block text-xs text-muted-foreground">{r.explicacion}</span>
                    {r.aceptada && r.aceptada_motivo && (
                      <span className="block text-xs text-muted-foreground">
                        Aceptada a propósito: {r.aceptada_motivo}
                      </span>
                    )}
                  </span>
                </button>

                {r.historico?.length > 1 && (
                  <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                    {t === "mejora" && <TrendingDown className="h-3 w-3" />}
                    {t === "empeora" && <TrendingUp className="h-3 w-3" />}
                    {evolucion(r.historico)}
                  </span>
                )}

                {r.n_casos < 0 ? (
                  <Badge variant="destructive">no se pudo medir</Badge>
                ) : (
                  <Badge
                    variant={r.aceptada ? "outline" : r.n_casos === 0 ? "secondary" : "destructive"}
                    className="font-mono tabular-nums"
                  >
                    {r.n_casos.toLocaleString("es-ES")}
                  </Badge>
                )}

                {r.aceptada ? (
                  <Button size="sm" variant="ghost" onClick={() => aceptar(r.codigo, false)}>
                    Volver a vigilar
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={motivo.trim().length < 3}
                    onClick={() => aceptar(r.codigo, true)}
                  >
                    Aceptar a propósito
                  </Button>
                )}
              </div>

              {abierto && (
                <div className="space-y-2 border-t bg-muted/30 px-4 py-3">
                  {casos.isLoading && <div className="text-sm text-muted-foreground">Cargando casos…</div>}
                  {!casos.isLoading && (casos.data ?? []).length === 0 && (
                    <div className="text-sm text-muted-foreground">Sin casos que mostrar.</div>
                  )}
                  <ul className="space-y-1 text-sm">
                    {(casos.data ?? []).slice(0, 100).map((c, i) => (
                      <li key={`${c.building_id ?? "x"}-${i}`}>
                        {c.building_id ? (
                          <Link className="underline underline-offset-2" to={`/comercial/edificios/${c.building_id}`}>
                            {c.detalle || c.building_id}
                          </Link>
                        ) : (
                          <span>{c.detalle}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Motivo para aceptar una regla a propósito"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">
          Escribe el motivo antes de pulsar «Aceptar a propósito» en la regla.
        </span>
      </div>
    </div>
  );
}

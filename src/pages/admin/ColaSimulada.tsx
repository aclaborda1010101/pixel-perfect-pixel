import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/common/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eyebrow } from "@/components/common/Eyebrow";
import { CheckCircle2, XCircle, HelpCircle, ShieldAlert, Eye, Ban } from "lucide-react";
import { ColaDemo } from "@/components/admin/ColaDemo";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Checkpoint = { key: string; label: string; estado: "PASS" | "FAIL" | "UNKNOWN"; valor: string; fuente: string };
type Row = {
  building_id: string;
  direccion: string | null;
  owner_id: string;
  nombre: string | null;
  telefono: string | null;
  cuota_pct: number | null;
  suma_cuotas: number | null;
  suma_nota: number | null;
  n_incoherentes: number | null;
  deal_estado: string | null;
  score_activo_raw: number | null;
  score_owner: number | null;
  dias_cadencia_vencida: number | null;
  apto_publicar_estricto: boolean;
  apto_observacion: boolean;
  checkpoints: Checkpoint[];
  bloqueos: string[] | null;
  prioridad: number | null;
  prioridad_explicacion: string | null;
};

const EstadoIcon = ({ estado }: { estado: Checkpoint["estado"] }) =>
  estado === "PASS" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
  : estado === "FAIL" ? <XCircle className="h-3.5 w-3.5 text-red-500" />
  : <HelpCircle className="h-3.5 w-3.5 text-amber-400" />;

function Fila({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm text-foreground">{r.direccion ?? "Sin dirección"}</div>
          <div className="truncate font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">
            {r.nombre ?? "Sin nombre"} · {r.cuota_pct != null ? `${Number(r.cuota_pct).toFixed(2).replace(".", ",")} %` : "sin %"} ·
            {" "}suma op. {Number(r.suma_cuotas ?? 0).toFixed(2).replace(".", ",")} % · suma nota{" "}
            {Number(r.suma_nota ?? 0).toFixed(2).replace(".", ",")} % · score_raw {Math.round(Number(r.score_activo_raw ?? 0))}
          </div>
        </button>
        <Badge variant="outline" className="font-mono text-[10px] tabular-nums">Prioridad {Number(r.prioridad ?? 0).toFixed(0)}</Badge>
        {r.apto_publicar_estricto ? (
          <Badge className="bg-emerald-500/15 text-emerald-500 border-transparent text-[10px]">Publicable</Badge>
        ) : r.apto_observacion ? (
          <Badge className="bg-amber-400/15 text-amber-500 border-transparent text-[10px]">No publicable · observación</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Excluido</Badge>
        )}
        <Link
          to={`/comercial/edificios/${r.building_id}`}
          className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground underline-offset-4 hover:underline"
        >
          Ver ficha
        </Link>
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-[4px] border border-border-faint bg-surface-1/40 p-3">
          <p className="text-xs text-muted-foreground">{r.prioridad_explicacion}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(r.checkpoints ?? []).map((c) => (
              <div key={c.key} className="flex items-start gap-2 text-xs">
                <EstadoIcon estado={c.estado} />
                <div className="min-w-0">
                  <div className="text-foreground">{c.label}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {c.estado} · {c.valor} · fuente: {c.fuente}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {(r.bloqueos ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(r.bloqueos ?? []).map((b) => (
                <Badge key={b} variant="destructive" className="text-[10px]">{b}</Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function ColaSimulada() {
  const [modo, setModo] = useState<"estrictos" | "demo">("estrictos");
  const { data, isLoading, error } = useQuery({
    queryKey: ["cola-simulada"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("v_cola_simulada" as any) as any)
        .select("*")
        .order("prioridad", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 60_000,
  });

  const rows = data ?? [];
  const estricto = useMemo(() => rows.filter((r) => r.apto_publicar_estricto), [rows]);
  const observacion = useMemo(() => rows.filter((r) => r.apto_observacion), [rows]);
  const excluidos = useMemo(
    () => rows.filter((r) => !r.apto_publicar_estricto && !r.apto_observacion),
    [rows],
  );

  const motivos = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of excluidos) for (const b of r.bloqueos ?? []) m.set(b, (m.get(b) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [excluidos]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulación de cola (solo lectura)"
        subtitle="Fase 0 de fiabilidad. Esta pantalla NO crea tareas ni modifica datos: solo evalúa qué parejas edificio–propietario cumplirían los requisitos de publicación."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Eyebrow>Modo</Eyebrow>
        <ToggleGroup
          type="single"
          value={modo}
          onValueChange={(v) => v && setModo(v as "estrictos" | "demo")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="estrictos">Controles estrictos</ToggleGroupItem>
          <ToggleGroupItem value="demo">Demostración (40)</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {modo === "demo" ? <ColaDemo /> : <>
      <Card className="border-amber-400/30">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>
            Simulación read-only. Ningún botón de esta página inserta tareas ni invoca la generación de cola.
            El contexto de scoring usa exclusivamente <span className="font-mono">score_raw</span> (score del activo sin propietarios).
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { l: "Estricto (publicable)", v: estricto.length, i: CheckCircle2 },
          { l: "Observación (no publicable)", v: observacion.length, i: Eye },
          { l: "Excluidos", v: excluidos.length, i: Ban },
        ].map((k) => (
          <Card key={k.l}>
            <CardHeader className="pb-2">
              <Eyebrow><k.i className="mr-1 inline h-3 w-3" /> {k.l}</Eyebrow>
              <CardTitle className="font-mono tabular-nums">{isLoading ? "…" : k.v}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">No se pudo cargar la simulación: {(error as any)?.message}</p>}

      <Tabs defaultValue="estricto">
        <TabsList>
          <TabsTrigger value="estricto">Estricto ({estricto.length})</TabsTrigger>
          <TabsTrigger value="observacion">Observación ({observacion.length})</TabsTrigger>
          <TabsTrigger value="excluidos">Excluidos ({excluidos.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="estricto">
          <Card>
            <CardContent className="p-0">
              {estricto.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  {isLoading ? "Cargando…" : "Ningún candidato cumple hoy los 12 checkpoints en modo estricto."}
                </p>
              ) : (
                <ul className="divide-y divide-border-faint">{estricto.map((r) => <Fila key={`${r.building_id}-${r.owner_id}`} r={r} />)}</ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="observacion">
          <Card className="border-amber-400/30">
            <CardHeader className="pb-2">
              <Eyebrow>No publicable · bloqueo porcentaje_sin_trazabilidad_nota</Eyebrow>
              <CardTitle className="text-base">
                Porcentajes completos y coherentes, pero sin respaldo de nota simple
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {observacion.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">{isLoading ? "Cargando…" : "Sin candidatos en observación."}</p>
              ) : (
                <ul className="divide-y divide-border-faint">{observacion.map((r) => <Fila key={`${r.building_id}-${r.owner_id}`} r={r} />)}</ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="excluidos">
          <Card>
            <CardHeader className="pb-2">
              <Eyebrow>Motivos de exclusión</Eyebrow>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {motivos.slice(0, 14).map(([m, n]) => (
                  <Badge key={m} variant="outline" className="text-[10px]">{m} · {n}</Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {excluidos.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground">{isLoading ? "Cargando…" : "Sin excluidos."}</p>
              ) : (
                <ul className="divide-y divide-border-faint">
                  {excluidos.slice(0, 200).map((r) => <Fila key={`${r.building_id}-${r.owner_id}`} r={r} />)}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </>}
    </div>
  );
}
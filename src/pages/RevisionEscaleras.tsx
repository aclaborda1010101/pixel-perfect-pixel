import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = {
  building_id: string;
  direccion: string | null;
  catalogo: string | null;
  manzana: string | null;
  visor_count: number | null;
  visor_conf: number | null;
  fxcc_segundas: boolean | null;
  fxcc_piso01: number | null;
  cluster_asignado: string | null;
  score: number | null;
  prioridad: number | null;
};

function pdfUrl(manzana: string | null) {
  if (!manzana) return null;
  return `https://servpub.madrid.es/VSURB_RSURBA/api_rsurba/v1/descargas/getDocumento?tipoDoc=ANEDIF&docId=${encodeURIComponent(
    manzana,
  )}&docId2=`;
}

export default function RevisionEscaleras() {
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["staircase-review-queue"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_staircase_review_queue")
        .select("*")
        .order("prioridad", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
    staleTime: 30_000,
  });

  const rows = data ?? [];
  const total = rows.length;

  const decide = async (row: Row, confirmed: boolean) => {
    const t = toast.loading(
      confirmed ? "Confirmando 2ª escalera…" : "Marcando 1 escalera…",
    );
    try {
      const { error: upErr } = await (supabase as any)
        .from("building_analysis")
        .update({
          second_staircase_confirmed: confirmed,
          second_staircase_confirmed_source: "revision_humana",
          second_staircase_confirmed_at: new Date().toISOString(),
        })
        .eq("building_id", row.building_id);
      if (upErr) throw upErr;

      const { error: rpcErr } = await (supabase.rpc as any)(
        "compute_cluster_score",
        { p_building_id: row.building_id },
      );
      if (rpcErr) throw rpcErr;

      toast.success(
        confirmed ? "2ª escalera confirmada" : "Marcado como 1 escalera",
        { id: t },
      );
      await qc.invalidateQueries({ queryKey: ["staircase-review-queue"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar", { id: t });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-end justify-between border-b border-border-faint pb-4">
        <div>
          <h1 className="font-editorial text-2xl tracking-notarial text-foreground">
            Revisión de escaleras
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cola de confirmación humana del cambio de uso (2ª escalera).
          </p>
        </div>
        <div className="font-mono text-sm tabular-nums text-muted-foreground">
          {isLoading ? "…" : `${total} edificio${total === 1 ? "" : "s"} pendiente${total === 1 ? "" : "s"} de revisar`}
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando cola…
        </div>
      ) : total === 0 ? (
        <div className="rounded-[6px] border border-border bg-card py-16 text-center">
          <div className="text-3xl">✅</div>
          <div className="mt-2 font-editorial text-lg">Todo revisado</div>
          <div className="text-sm text-muted-foreground">
            No quedan edificios en la cola.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <ReviewCard
              key={r.building_id}
              row={r}
              onConfirm={() => decide(r, true)}
              onReject={() => decide(r, false)}
              busy={isFetching}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  row,
  onConfirm,
  onReject,
  busy,
}: {
  row: Row;
  onConfirm: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const url = useMemo(() => pdfUrl(row.manzana), [row.manzana]);
  const conf =
    row.visor_conf != null ? `${Math.round(Number(row.visor_conf) * 100)}%` : "—";
  const fxccSignals: string[] = [];
  if (row.fxcc_segundas) fxccSignals.push("FXCC: hay viviendas en 2ª planta");
  if (row.fxcc_piso01 != null)
    fxccSignals.push(`FXCC piso01 = ${row.fxcc_piso01}`);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{row.direccion ?? "—"}</CardTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {row.cluster_asignado && (
              <Badge variant="secondary" className="font-mono">
                {row.cluster_asignado}
              </Badge>
            )}
            {row.score != null && (
              <span className="font-mono tabular-nums">
                score {Number(row.score).toFixed(1)}
              </span>
            )}
            {row.prioridad != null && (
              <span className="font-mono tabular-nums">
                · prioridad {Number(row.prioridad).toFixed(1)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">
          <div>catálogo {row.catalogo ?? "—"}</div>
          <div>manzana {row.manzana ?? "—"}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-[4px] border border-border-faint bg-surface-1/30 p-3 text-sm">
          <div>
            Visor sugiere{" "}
            <strong>{row.visor_count ?? "—"} escalera{row.visor_count === 1 ? "" : "s"}</strong>{" "}
            <span className="text-muted-foreground">(confianza {conf})</span>
          </div>
          {fxccSignals.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {fxccSignals.join(" · ")}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {url && (
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Ver croquis oficial (PG97)
              </a>
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onReject}
              disabled={busy}
            >
              <X className="h-4 w-4" />
              No, 1 escalera
            </Button>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={busy}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" />
              Confirmar 2ª escalera
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
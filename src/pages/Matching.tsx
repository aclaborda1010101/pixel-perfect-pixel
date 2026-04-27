import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { BetaBanner } from "@/components/common/BetaBanner";

export default function Matching() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [recalc, setRecalc] = useState(false);
  const load = () => {
    supabase
      .from("match_candidates")
      .select("*, assets(tipo,ubicacion,ciudad), investors(nombre,consentimiento)")
      .order("score", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  };
  useEffect(load, []);

  const setEstado = async (
    row: any,
    estado: "aprobado" | "rechazado" | "contactado" | "propuesto",
  ) => {
    // HITL: si se aprueba un match y el inversor no tiene consentimiento, bloquear y abrir caso
    if (estado === "aprobado" && row.investors && row.investors.consentimiento === false) {
      await supabase.from("compliance_cases").insert({
        scope_type: "match",
        scope_id: row.id,
        motivo: `Aprobación bloqueada: inversor "${row.investors.nombre}" sin consentimiento`,
        evidencia: row.evidencia ?? null,
        dpia_ok: false,
      });
      toast.error("Bloqueado por compliance — caso creado");
      return;
    }
    const { error } = await supabase.from("match_candidates").update({ estado }).eq("id", row.id);
    if (error) toast.error(error.message);
    else { toast.success("Actualizado"); load(); }
  };

  const recompute = async () => {
    setRecalc(true);
    try {
      const { data, error } = await supabase.functions.invoke("compute_matches", { body: { threshold: 0.6 } });
      if (error) throw error;
      const r = data as any;
      toast.success(`Evaluados ${r.evaluated} · nuevos ${r.inserted}`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally { setRecalc(false); }
  };

  return (
    <div>
      <PageHeader
        title={t.nav.matching}
        subtitle="Cola de candidatos asset ↔ inversor"
        actions={
          <Button size="sm" onClick={recompute} disabled={recalc}>
            {recalc ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
            Recalcular
          </Button>
        }
      />
      <BetaBanner />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">
                  {r.investors?.nombre ?? "?"} ↔ {r.assets?.tipo} {r.assets?.ubicacion}
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.assets?.ciudad ?? "—"} · score {Number(r.score).toFixed(2)}
                  {r.investors?.consentimiento === false && " · ⚠ inversor sin consentimiento"}
                </div>
                {r.evidencia && <div className="text-xs mt-1">{r.evidencia}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{r.estado}</Badge>
                {r.estado === "propuesto" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEstado(r, "rechazado")}>Rechazar</Button>
                    <Button size="sm" onClick={() => setEstado(r, "aprobado")}>Aprobar</Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
        </ul>
      </Card>
    </div>
  );
}
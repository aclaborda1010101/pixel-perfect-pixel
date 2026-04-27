import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function Matching() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => {
    supabase
      .from("match_candidates")
      .select("*, assets(tipo,ubicacion,ciudad), investors(nombre)")
      .order("score", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  };
  useEffect(load, []);

  const setEstado = async (id: string, estado: string) => {
    const { error } = await supabase.from("match_candidates").update({ estado }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Actualizado"); load(); }
  };

  return (
    <div>
      <PageHeader title={t.nav.matching} subtitle="Cola de candidatos asset ↔ inversor" />
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
                </div>
                {r.evidencia && <div className="text-xs mt-1">{r.evidencia}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{r.estado}</Badge>
                {r.estado === "propuesto" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEstado(r.id, "rechazado")}>Rechazar</Button>
                    <Button size="sm" onClick={() => setEstado(r.id, "aprobado")}>Aprobar</Button>
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
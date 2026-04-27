import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { ValuatorButton } from "@/components/agents/ValuatorButton";

export default function Assets() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => {
    supabase.from("assets").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <PageHeader title={t.nav.assets} />
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Ubicación</th>
              <th className="px-4 py-3">Superficie</th>
              <th className="px-4 py-3">Valoración</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3"><Badge variant="outline">{a.tipo}</Badge></td>
                <td className="px-4 py-3">
                  <Link to={`/activos/${a.id}`} className="font-medium hover:text-primary">
                    {a.ubicacion}{a.ciudad ? `, ${a.ciudad}` : ""}
                  </Link>
                </td>
                <td className="px-4 py-3">{a.superficie_m2 ?? "—"} m²</td>
                <td className="px-4 py-3">{a.valoracion_estimada ? `${Number(a.valoracion_estimada).toLocaleString()} €` : "—"}</td>
                <td className="px-4 py-3"><Badge>{a.estado}</Badge></td>
                <td className="px-4 py-3 text-right">
                  <ValuatorButton assetId={a.id} onDone={load} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
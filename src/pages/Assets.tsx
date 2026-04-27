import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";

export default function Assets() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("assets").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
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
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3"><Badge variant="outline">{a.tipo}</Badge></td>
                <td className="px-4 py-3">{a.ubicacion}{a.ciudad ? `, ${a.ciudad}` : ""}</td>
                <td className="px-4 py-3">{a.superficie_m2 ?? "—"} m²</td>
                <td className="px-4 py-3">{a.valoracion_estimada ? `${Number(a.valoracion_estimada).toLocaleString()} €` : "—"}</td>
                <td className="px-4 py-3"><Badge>{a.estado}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
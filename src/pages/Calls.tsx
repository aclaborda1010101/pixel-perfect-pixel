import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PhoneCall } from "lucide-react";

export default function Calls() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("calls")
      .select("id, fecha, duracion_seg, direccion, resumen, owner_id, owners(nombre)")
      .order("fecha", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <div>
      <PageHeader
        title={t.callsPage.title}
        subtitle={t.callsPage.subtitle}
        actions={
          <Link to="/analizar-llamada"><Button size="sm">{t.callsPage.uploadCta}</Button></Link>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="Aún no has registrado llamadas"
          description="Sube una grabación o pega la transcripción para que la IA la procese."
          ctaLabel="Analizar una llamada"
          ctaTo="/analizar-llamada"
        />
      ) : (
      <Card>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">{t.callsPage.colOwner}</th>
              <th className="px-4 py-3">{t.callsPage.colDate}</th>
              <th className="px-4 py-3">{t.callsPage.colDuration}</th>
              <th className="px-4 py-3">{t.callsPage.colDirection}</th>
              <th className="px-4 py-3">{t.callsPage.colSummary}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link to={`/llamadas/${c.id}`} className="font-medium hover:text-primary">
                    {c.owners?.nombre ?? "—"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(c.fecha).toLocaleString()}</td>
                <td className="px-4 py-3">{c.duracion_seg ?? 0}s</td>
                <td className="px-4 py-3"><Badge variant="outline">{c.direccion}</Badge></td>
                <td className="px-4 py-3 max-w-md truncate text-muted-foreground">
                  {c.resumen ?? <StatusBadge status="no_summary" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      )}
    </div>
  );
}

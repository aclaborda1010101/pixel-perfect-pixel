import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";

export default function Investors() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("investors").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <div>
      <PageHeader title={t.nav.investors} />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((i) => (
            <li key={i.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{i.nombre}</div>
                <div className="flex gap-1">
                  {(i.tipos_activo ?? []).map((tp: string) => <Badge key={tp} variant="outline">{tp}</Badge>)}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Ticket {i.ticket_min ? Number(i.ticket_min).toLocaleString() : "?"} – {i.ticket_max ? Number(i.ticket_max).toLocaleString() : "?"} €
                · Ciudades: {(i.ciudades ?? []).join(", ") || "—"}
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
        </ul>
      </Card>
    </div>
  );
}
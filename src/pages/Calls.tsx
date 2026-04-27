import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";

export default function Calls() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("calls").select("*").order("fecha", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <div>
      <PageHeader title={t.nav.calls} />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline">{c.direccion}</Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(c.fecha).toLocaleString()} · {c.duracion_seg ?? 0}s
                </span>
              </div>
              {c.resumen && <div className="mt-1 text-sm">{c.resumen}</div>}
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
        </ul>
      </Card>
    </div>
  );
}
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";

export default function Buildings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("buildings").select("*").order("updated_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <div>
      <PageHeader title={t.nav.buildings} />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{b.direccion}</div>
                <div className="text-xs text-muted-foreground">
                  {b.ciudad}{b.codigo_postal ? ` · ${b.codigo_postal}` : ""} · {b.numero_propietarios ?? "?"} prop.
                </div>
              </div>
              <div className="flex items-center gap-2">
                {b.division_horizontal && <Badge variant="secondary">DH</Badge>}
                <Badge variant="outline">{b.estado}</Badge>
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
        </ul>
      </Card>
    </div>
  );
}
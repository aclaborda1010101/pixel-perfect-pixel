import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Building2 } from "lucide-react";
import { NewBuildingDialog } from "@/components/forms/NewEntityDialogs";

export default function Buildings() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const load = async () => {
    const { data } = await supabase.from("buildings").select("*").order("updated_at", { ascending: false });
    setRows(data ?? []);
    if (data && data.length) {
      const { data: bo } = await supabase.from("building_owners").select("building_id").in("building_id", data.map((b) => b.id));
      const c: Record<string, number> = {};
      (bo ?? []).forEach((r: any) => { c[r.building_id] = (c[r.building_id] ?? 0) + 1; });
      setCounts(c);
    }
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title={t.nav.buildings} actions={<NewBuildingDialog onCreated={load} />} />
      {rows.length === 0 ? (
        <EmptyState icon={Building2} title="Aún no hay edificios" description="Crea un edificio para asociarle propietarios (con su sub-rol y cuota) y luego activos." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {rows.map((b) => (
              <li key={b.id}>
                <Link to={`/edificios/${b.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-accent/30">
                  <div>
                    <div className="text-sm font-medium">{b.direccion}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.ciudad}{b.codigo_postal ? ` · ${b.codigo_postal}` : ""} · {counts[b.id] ?? 0} prop.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {b.division_horizontal && <Badge variant="secondary">DH</Badge>}
                    <Badge variant="outline">{b.estado}</Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function Compliance() {
  const { t } = useI18n();
  const [rows, setRows] = useState<any[]>([]);
  const load = () => {
    supabase.from("compliance_cases").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows(data ?? []));
  };
  useEffect(() => { load(); }, []);

  const resolve = async (id: string) => {
    const { error } = await supabase.from("compliance_cases")
      .update({ estado: "aprobado", resuelto_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Resuelto"); load(); }
  };

  return (
    <div>
      <PageHeader title={t.nav.compliance} subtitle="Human-in-the-loop" />
      <Card>
        <ul className="divide-y divide-border">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{c.motivo}</div>
                <div className="text-xs text-muted-foreground">
                  {c.scope_type}{c.scope_id ? ` · ${String(c.scope_id).slice(0, 8)}…` : ""} · {new Date(c.created_at).toLocaleString()}
                </div>
                {c.evidencia && <div className="text-xs mt-1">{c.evidencia}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={c.estado === "pendiente" ? "destructive" : "outline"}>{c.estado}</Badge>
                {c.estado === "pendiente" && (
                  <Button size="sm" onClick={() => resolve(c.id)}>Resolver</Button>
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
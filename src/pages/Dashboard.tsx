import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { Users, PhoneCall, GitMerge, ShieldAlert } from "lucide-react";

export default function Dashboard() {
  const { t } = useI18n();
  const [k, setK] = useState({ owners: 0, calls: 0, matches: 0, compliance: 0 });

  useEffect(() => {
    (async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const [a, b, c, d] = await Promise.all([
        supabase.from("owners").select("id", { count: "exact", head: true }),
        supabase.from("calls").select("id", { count: "exact", head: true }).gte("fecha", since.toISOString()),
        supabase.from("match_candidates").select("id", { count: "exact", head: true }).eq("estado", "propuesto"),
        supabase.from("compliance_cases").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
      ]);
      setK({
        owners: a.count ?? 0,
        calls: b.count ?? 0,
        matches: c.count ?? 0,
        compliance: d.count ?? 0,
      });
    })();
  }, []);

  const tiles = [
    { label: t.dashboard.kpiOwners, value: k.owners, icon: Users },
    { label: t.dashboard.kpiCallsWeek, value: k.calls, icon: PhoneCall },
    { label: t.dashboard.kpiPendingMatches, value: k.matches, icon: GitMerge },
    { label: t.dashboard.kpiComplianceOpen, value: k.compliance, icon: ShieldAlert },
  ];

  return (
    <div>
      <PageHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tile.label}
              </CardTitle>
              <tile.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{tile.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
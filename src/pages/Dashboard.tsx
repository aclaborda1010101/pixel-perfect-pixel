import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { PhoneOutgoing, FileAudio, ArrowRight, PhoneCall, ListChecks, UserSearch } from "lucide-react";

export default function Dashboard() {
  const { t } = useI18n();
  const [k, setK] = useState({ pendingAnalysis: 0, pendingActions: 0, uncataloged: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [a, b, c, r] = await Promise.all([
        supabase.from("calls").select("id", { count: "exact", head: true }).is("resumen", null),
        supabase.from("next_actions").select("id", { count: "exact", head: true }).eq("estado", "pendiente"),
        supabase.from("owners").select("id", { count: "exact", head: true }).eq("rol", "desconocido"),
        supabase.from("calls").select("id, fecha, duracion_seg, resumen, owner_id, owners(nombre)")
          .order("fecha", { ascending: false }).limit(6),
      ]);
      setK({
        pendingAnalysis: a.count ?? 0,
        pendingActions: b.count ?? 0,
        uncataloged: c.count ?? 0,
      });
      setRecent(r.data ?? []);
    })();
  }, []);

  const tiles = [
    { label: t.home.kpiPendingAnalysis, value: k.pendingAnalysis, icon: PhoneCall, to: "/llamadas" },
    { label: t.home.kpiPendingActions, value: k.pendingActions, icon: ListChecks, to: "/propietarios" },
    { label: t.home.kpiUncatalogedOwners, value: k.uncataloged, icon: UserSearch, to: "/propietarios" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t.home.title} subtitle={t.home.subtitle} />

      <div className="grid gap-4 md:grid-cols-3">
        {tiles.map((tile) => (
          <Link to={tile.to} key={tile.label}>
            <Card className="transition hover:border-primary/50">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tile.label}</CardTitle>
                <tile.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-3xl font-semibold">{tile.value}</div></CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.home.whatToDo}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Link to="/preparar-llamada">
            <div className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-5 transition hover:border-primary hover:bg-accent/30">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary"><PhoneOutgoing className="h-5 w-5" /></div>
                <div className="text-base font-semibold">{t.home.ctaPrepare}</div>
              </div>
              <div className="text-sm text-muted-foreground">{t.home.ctaPrepareDesc}</div>
              <div className="mt-auto flex items-center gap-1 text-sm text-primary opacity-0 transition group-hover:opacity-100">
                {t.common.next} <ArrowRight className="h-3 w-3" />
              </div>
            </div>
          </Link>
          <Link to="/analizar-llamada">
            <div className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-5 transition hover:border-primary hover:bg-accent/30">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary"><FileAudio className="h-5 w-5" /></div>
                <div className="text-base font-semibold">{t.home.ctaAnalyze}</div>
              </div>
              <div className="text-sm text-muted-foreground">{t.home.ctaAnalyzeDesc}</div>
              <div className="mt-auto flex items-center gap-1 text-sm text-primary opacity-0 transition group-hover:opacity-100">
                {t.common.next} <ArrowRight className="h-3 w-3" />
              </div>
            </div>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t.home.readyQueue}</CardTitle>
          <Link to="/llamadas" className="text-xs text-muted-foreground hover:text-foreground">{t.home.viewAll}</Link>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">{t.home.noCalls}</div>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link to={`/llamadas/${c.id}`} className="flex items-center justify-between px-6 py-3 hover:bg-accent/30">
                    <div>
                      <div className="text-sm font-medium">{c.owners?.nombre ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(c.fecha).toLocaleString()} · {c.duracion_seg ?? 0}s
                      </div>
                    </div>
                    <Badge variant={c.resumen ? "outline" : "default"}>
                      {c.resumen ? "Listo" : "Por analizar"}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ShieldCheck, Check, Circle } from "lucide-react";

const GDPR_CHECKLIST = [
  { id: "consent", label: "Consentimientos registrados por propietario", done: true },
  { id: "dpia", label: "DPIA completada para perfilado IA", done: true },
  { id: "retention", label: "Política de retención de transcripciones", done: true },
  { id: "rectif", label: "Procedimiento de derecho de rectificación", done: false },
  { id: "audit", label: "Auditoría trimestral de accesos", done: false },
];

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

  const pending = useMemo(() => rows.filter((r) => r.estado === "pendiente").length, [rows]);
  const resolved = useMemo(() => rows.filter((r) => r.estado === "aprobado").length, [rows]);
  const checkDone = GDPR_CHECKLIST.filter((c) => c.done).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operaciones · Compliance"
        title={t.nav.compliance}
        subtitle="Human-in-the-loop · GDPR"
      />

      <div className="rounded-[6px] border border-border-faint bg-surface-1/30 px-4 py-3 text-xs text-muted-foreground">
        {t.compliancePage.explainer}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Casos pendientes</Eyebrow><div className="mt-2"><MetricValue size="lg">{pending}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Casos resueltos</Eyebrow><div className="mt-2"><MetricValue size="lg">{resolved}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Checklist GDPR</Eyebrow><div className="mt-2"><MetricValue size="lg">{checkDone}/{GDPR_CHECKLIST.length}</MetricValue></div></div></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <CardHeader>
            <Eyebrow>Auditoría · HITL</Eyebrow>
            <CardTitle>Casos abiertos</CardTitle>
          </CardHeader>
          {rows.length === 0 ? (
            <CardContent>
              <EmptyState icon={ShieldCheck} title="Sin casos abiertos" description="No hay alertas de compliance en cola." className="border-0 shadow-none" />
            </CardContent>
          ) : (
            <ul className="divide-y divide-border-faint">
              {rows.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">{c.motivo}</div>
                    <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                      {c.scope_type}{c.scope_id ? ` · ${String(c.scope_id).slice(0, 8)}…` : ""} · {new Date(c.created_at).toLocaleString()}
                    </div>
                    {c.evidencia && <div className="mt-1.5 text-xs text-muted-foreground">{c.evidencia}</div>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={c.estado === "pendiente" ? "review" : "done"} label={c.estado} />
                    {c.estado === "pendiente" && (
                      <Button size="sm" variant="gold" onClick={() => resolve(c.id)}>Resolver</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <aside>
          <Card>
            <CardHeader>
              <Eyebrow>GDPR</Eyebrow>
              <CardTitle>Checklist</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <ul className="space-y-2.5">
                {GDPR_CHECKLIST.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5 text-sm">
                    <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${c.done ? "border-success bg-success-soft text-success" : "border-border-faint text-muted-foreground"}`}>
                      {c.done ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
                    </span>
                    <span className={c.done ? "text-foreground" : "text-muted-foreground"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

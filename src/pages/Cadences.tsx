import { useEffect, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Eyebrow } from "@/components/common/Eyebrow";
import { MetricValue } from "@/components/common/MetricValue";
import { StatusBadge } from "@/components/common/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { BetaBanner } from "@/components/common/BetaBanner";
import { MessageSquareDot } from "lucide-react";

export default function Cadences() {
  const { t } = useI18n();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [steps, setSteps] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("whatsapp_messages").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setMsgs(data ?? []));
    supabase.from("cadence_steps").select("*").order("dia_offset")
      .then(({ data }) => setSteps(data ?? []));
  }, []);

  const sent = useMemo(() => msgs.filter((m) => ["sent", "delivered", "read"].includes(m.status)).length, [msgs]);
  const replied = useMemo(() => msgs.filter((m) => m.status === "replied").length, [msgs]);
  const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operaciones · Cadencias"
        title={t.nav.cadences}
        subtitle="Secuencias automatizadas y mensajes WhatsApp"
      />
      <BetaBanner />

      <div className="rounded-[6px] border border-warning/40 bg-warning-soft px-4 py-2.5 text-xs text-warning">
        {t.cadences.mockBanner}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><div className="p-5"><Eyebrow>Mensajes enviados</Eyebrow><div className="mt-2"><MetricValue size="lg">{sent}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Respuestas</Eyebrow><div className="mt-2"><MetricValue size="lg">{replied}</MetricValue></div></div></Card>
        <Card><div className="p-5"><Eyebrow>Tasa de respuesta</Eyebrow><div className="mt-2"><MetricValue size="lg" unit="%">{replyRate}</MetricValue></div></div></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <Eyebrow>WhatsApp</Eyebrow>
            <CardTitle>Mensajes ({msgs.length})</CardTitle>
          </CardHeader>
          {msgs.length === 0 ? (
            <CardContent><EmptyState icon={MessageSquareDot} title="Sin mensajes" description="Cuando lances la primera cadencia, los mensajes aparecerán aquí." className="border-0 shadow-none" /></CardContent>
          ) : (
            <ul className="divide-y divide-border-faint">
              {msgs.map((m) => (
                <li key={m.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{m.status}</Badge>
                    <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                      {m.programado_para ? new Date(m.programado_para).toLocaleString() : "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm text-foreground">{m.cuerpo}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <Eyebrow>Secuencia</Eyebrow>
            <CardTitle>Pasos de cadencia ({steps.length})</CardTitle>
          </CardHeader>
          {steps.length === 0 ? (
            <CardContent><EmptyState icon={MessageSquareDot} title="Sin pasos definidos" description="Configura los pasos de la secuencia para empezar." className="border-0 shadow-none" /></CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Día</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Plantilla</TableHead>
                  <TableHead className="text-right">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono tabular-nums text-foreground">D+{s.dia_offset}</TableCell>
                    <TableCell><Badge variant="outline">{s.tipo}</Badge></TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">{s.plantilla ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={s.estado === "ejecutado" ? "done" : "action_pending"} label={s.estado} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

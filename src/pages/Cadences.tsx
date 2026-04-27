import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { supabase } from "@/integrations/supabase/client";
import { BetaBanner } from "@/components/common/BetaBanner";

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
  return (
    <div>
      <PageHeader title={t.nav.cadences} />
      <BetaBanner />
      <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
        {t.cadences.mockBanner}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="border-b border-border px-4 py-2 text-sm font-medium">Mensajes WhatsApp ({msgs.length})</div>
          <ul className="divide-y divide-border">
            {msgs.map((m) => (
              <li key={m.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{m.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {m.programado_para ? new Date(m.programado_para).toLocaleString() : "—"}
                  </span>
                </div>
                <div className="mt-1 text-sm">{m.cuerpo}</div>
              </li>
            ))}
            {msgs.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
          </ul>
        </Card>
        <Card>
          <div className="border-b border-border px-4 py-2 text-sm font-medium">Pasos de cadencia ({steps.length})</div>
          <ul className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>D+{s.dia_offset} · {s.tipo}</span>
                  <Badge variant="outline">{s.estado}</Badge>
                </div>
                {s.plantilla && <div className="text-xs text-muted-foreground mt-1">{s.plantilla}</div>}
              </li>
            ))}
            {steps.length === 0 && <li className="px-4 py-6 text-center text-muted-foreground">{t.common.empty}</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
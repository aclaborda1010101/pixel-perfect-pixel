import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";

export default function Leads() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Captación" title={t.placeholders.leadsTitle} subtitle={t.common.comingSoon} />
      <EmptyState icon={Inbox} title={t.placeholders.leadsTitle} description={t.placeholders.leadsDesc} />
    </div>
  );
}

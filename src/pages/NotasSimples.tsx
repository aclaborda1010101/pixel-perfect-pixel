import { FileText } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";

export default function NotasSimples() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Captación" title={t.placeholders.notasSimplesTitle} subtitle={t.common.comingSoon} />
      <EmptyState icon={FileText} title={t.placeholders.notasSimplesTitle} description={t.placeholders.notasSimplesDesc} />
    </div>
  );
}

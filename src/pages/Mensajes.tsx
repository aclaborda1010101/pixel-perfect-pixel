import { Megaphone } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useI18n } from "@/i18n/I18nProvider";

export default function Mensajes() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="IA & Mensajes" title={t.placeholders.mensajesTitle} subtitle={t.common.comingSoon} />
      <EmptyState icon={Megaphone} title={t.placeholders.mensajesTitle} description={t.placeholders.mensajesDesc} />
    </div>
  );
}

import { Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function BetaBanner() {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-800 dark:text-amber-300">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="text-sm">
        <div className="font-medium">{t.beta.title}</div>
        <div className="text-xs opacity-90">{t.beta.desc}</div>
      </div>
    </div>
  );
}

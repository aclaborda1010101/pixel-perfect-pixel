import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <PageHeader title={t.nav.settings} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">{t.settings.language}</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {(["es", "en"] as const).map((l) => (
              <Button key={l} variant={locale === l ? "default" : "outline"} size="sm" onClick={() => setLocale(l)}>
                {l === "es" ? "Español" : "English"}
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">{t.settings.theme}</CardTitle></CardHeader>
          <CardContent className="flex gap-2">
            {(["light", "dark", "system"] as const).map((th) => (
              <Button key={th} variant={theme === th ? "default" : "outline"} size="sm" onClick={() => setTheme(th)}>
                {th === "light" ? t.settings.themeLight : th === "dark" ? t.settings.themeDark : t.settings.themeSystem}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
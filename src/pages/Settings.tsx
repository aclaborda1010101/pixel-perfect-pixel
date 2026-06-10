import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Languages, Palette, User, Users } from "lucide-react";
import { HubspotPanel } from "@/components/settings/HubspotPanel";
import { RolesPanel } from "@/components/settings/RolesPanel";
import { BuildingAssignmentsPanel } from "@/components/settings/BuildingAssignmentsPanel";
import { AnalisisIAPanel } from "@/components/settings/AnalisisIAPanel";
import { SubZonasPanel } from "@/components/settings/SubZonasPanel";
import { AprendizajePanel } from "@/components/settings/AprendizajePanel";
import { KnowledgeBasePanel } from "@/components/settings/KnowledgeBasePanel";
import { EnrichmentConfigPanel } from "@/components/settings/EnrichmentConfigPanel";
import { useCurrentRole } from "@/hooks/useCurrentRole";

export default function Settings() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { isAdmin } = useCurrentRole();
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cuenta · Ajustes"
        title={t.nav.settings}
        subtitle="Preferencias del panel"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <HubspotPanel />
        {isAdmin && <RolesPanel />}
        {isAdmin && <BuildingAssignmentsPanel />}
        <AnalisisIAPanel />
        {isAdmin && <SubZonasPanel />}
        {isAdmin && <AprendizajePanel />}
        {isAdmin && <KnowledgeBasePanel />}
        {isAdmin && <EnrichmentConfigPanel />}
        <Card>
          <CardHeader>
            <Eyebrow><Languages className="mr-1 inline h-3 w-3" /> Idioma</Eyebrow>
            <CardTitle>{t.settings.language}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(["es", "en"] as const).map((l) => (
              <Button key={l} variant={locale === l ? "gold" : "outline"} size="sm" onClick={() => setLocale(l)}>
                {l === "es" ? "Español" : "English"}
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Eyebrow><Palette className="mr-1 inline h-3 w-3" /> Apariencia</Eyebrow>
            <CardTitle>{t.settings.theme}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(["light", "dark", "system"] as const).map((th) => (
              <Button key={th} variant={theme === th ? "gold" : "outline"} size="sm" onClick={() => setTheme(th)}>
                {th === "light" ? t.settings.themeLight : th === "dark" ? t.settings.themeDark : t.settings.themeSystem}
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Eyebrow><User className="mr-1 inline h-3 w-3" /> Cuenta</Eyebrow>
            <CardTitle>Usuario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gold/50 bg-surface-1 font-mono text-xs text-gold">AQ</div>
              <div>
                <div className="font-medium text-foreground">Álvaro Quintana</div>
                <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">Founder</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Eyebrow>Email</Eyebrow>
                <div className="text-foreground">alvaro@afflux.es</div>
              </div>
              <div>
                <Eyebrow>Plan</Eyebrow>
                <div><Badge variant="gold">Beta</Badge></div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Eyebrow><Users className="mr-1 inline h-3 w-3" /> Equipo</Eyebrow>
            <CardTitle>Miembros</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border-faint text-sm">
              <li className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gold/40 bg-surface-1 font-mono text-[10px] text-gold">AQ</div>
                  <span className="text-foreground">Álvaro Quintana</span>
                </div>
                <Badge variant="info">Owner</Badge>
              </li>
              <li className="flex items-center justify-between py-2 text-muted-foreground">
                <span className="font-mono text-[11px] uppercase tracking-eyebrow">Invitar miembro</span>
                <Button size="sm" variant="outline" disabled>Invitar</Button>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

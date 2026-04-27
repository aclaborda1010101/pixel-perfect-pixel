import { Moon, Sun, Languages, Monitor } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Search } from "lucide-react";

export function Topbar() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme, resolved } = useTheme();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger />
      <div className="ml-2 flex-1">
        <h1 className="text-sm font-medium text-muted-foreground">
          {t.appName} · <span className="text-foreground">{t.appTagline}</span>
        </h1>
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        className="hidden h-8 items-center gap-2 rounded-md border border-border bg-muted/50 px-2 text-xs text-muted-foreground transition-colors hover:bg-muted sm:inline-flex"
        aria-label="Buscar"
      >
        <Search className="h-3 w-3" />
        <span>Buscar…</span>
        <kbd className="ml-2 rounded border border-border bg-background px-1 font-mono text-[10px]">⌘K</kbd>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2">
            <Languages className="h-4 w-4" />
            <span className="uppercase">{locale}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setLocale("es")}>
            Español
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocale("en")}>
            English
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t.settings.theme}>
            {resolved === "dark" ? (
              <Moon className="h-4 w-4" />
            ) : (
              <Sun className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" /> {t.settings.themeLight}
            {theme === "light" && " ✓"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" /> {t.settings.themeDark}
            {theme === "dark" && " ✓"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="mr-2 h-4 w-4" /> {t.settings.themeSystem}
            {theme === "system" && " ✓"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
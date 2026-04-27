import { Moon, Sun, Languages, Monitor, Search, ChevronRight, Check } from "lucide-react";
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
import { useLocation, Link } from "react-router-dom";

function useCrumbs() {
  const { pathname } = useLocation();
  if (pathname === "/") return [{ label: "Inicio", to: "/" }];
  const parts = pathname.split("/").filter(Boolean);
  const acc: { label: string; to: string }[] = [{ label: "Inicio", to: "/" }];
  let path = "";
  for (const p of parts) {
    path += "/" + p;
    acc.push({
      label: decodeURIComponent(p).replace(/-/g, " "),
      to: path,
    });
  }
  return acc;
}

export function Topbar() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme, resolved } = useTheme();
  const crumbs = useCrumbs();

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-[inset_0_-1px_0_0_hsl(var(--gold)/0.25)]">
      <SidebarTrigger className="text-muted-foreground hover:text-foreground" />

      <nav
        aria-label="Breadcrumb"
        className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground md:flex"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={c.to} className="flex items-center gap-1.5">
              {last ? (
                <span className="text-foreground">{c.label}</span>
              ) : (
                <Link to={c.to} className="transition-colors hover:text-foreground">
                  {c.label}
                </Link>
              )}
              {!last && <ChevronRight className="h-3 w-3 opacity-50" />}
            </span>
          );
        })}
      </nav>

      <div className="flex flex-1 items-center justify-center px-4">
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }
          className="group flex h-9 w-full max-w-md items-center gap-2 rounded-[6px] border border-border bg-surface-1/40 px-3 text-xs text-muted-foreground transition-colors hover:border-gold/40 hover:bg-surface-1/70"
          aria-label="Buscar"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Buscar activos, propietarios, llamadas…</span>
          <kbd className="rounded-[3px] border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      <span className="hidden rounded-[3px] border border-gold/40 bg-gold-soft/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-gold sm:inline-flex">
        Beta
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <Languages className="h-4 w-4" />
            <span className="uppercase">{locale}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setLocale("es")}>Español</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocale("en")}>English</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t.settings.theme} className="text-muted-foreground">
            {resolved === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" /> {t.settings.themeLight}
            {theme === "light" && <Check className="ml-auto h-3.5 w-3.5 text-gold" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" /> {t.settings.themeDark}
            {theme === "dark" && <Check className="ml-auto h-3.5 w-3.5 text-gold" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="mr-2 h-4 w-4" /> {t.settings.themeSystem}
            {theme === "system" && <Check className="ml-auto h-3.5 w-3.5 text-gold" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-1 flex items-center gap-2 border-l border-border pl-3">
        <div className="hidden flex-col items-end leading-tight md:flex">
          <span className="text-xs font-medium text-foreground">Álvaro Quintana</span>
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
            Founder
          </span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gold/50 bg-surface-1 font-mono text-xs text-gold">
          AQ
        </div>
      </div>
    </header>
  );
}
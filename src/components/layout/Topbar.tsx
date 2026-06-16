import { Moon, Sun, Languages, Monitor, Check, Menu, LogOut, Shield, Users, Map, Sparkles } from "lucide-react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { usePageTitle } from "./PageTitleContext";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { toast } from "sonner";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEGMENT_LABELS: Record<string, string> = {
  "": "Dashboard",
  propietarios: "Propietarios",
  edificios: "Edificios",
  activos: "Activos",
  llamadas: "Llamadas",
  inversores: "Inversores",
  leads: "Leads marketing",
  "notas-simples": "Notas Simples",
  mensajes: "Mensajes",
  asistente: "Asistente IA",
  ajustes: "Configuración",
  configuracion: "Configuración",
  "preparar-llamada": "Preparar llamada",
  "analizar-llamada": "Analizar llamada",
};

function useCrumbs(pageTitle: string | null) {
  const { pathname } = useLocation();
  if (pathname === "/") return [{ label: "Dashboard", to: "/" }];
  const parts = pathname.split("/").filter(Boolean);
  const acc: { label: string; to: string }[] = [{ label: "Dashboard", to: "/" }];
  let path = "";
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    path += "/" + p;
    const isLast = i === parts.length - 1;
    let label: string;
    if (UUID_RE.test(p)) {
      label = isLast && pageTitle ? pageTitle : "Detalle";
    } else {
      label = SEGMENT_LABELS[p] ?? decodeURIComponent(p).replace(/-/g, " ");
    }
    acc.push({ label, to: path });
  }
  if (pageTitle && acc.length > 1) {
    const last = acc[acc.length - 1];
    if (UUID_RE.test(parts[parts.length - 1] ?? "")) {
      last.label = pageTitle;
    }
  }
  return acc;
}

export function Topbar() {
  const { locale, setLocale, t } = useI18n();
  const { theme, setTheme, resolved } = useTheme();
  const { title } = usePageTitle();
  const crumbs = useCrumbs(title);
  const { isMobile, setOpenMobile } = useSidebar();
  const { user, signOut } = useAuth();
  const { isAdmin } = useCurrentRole();
  const navigate = useNavigate();

  const fullName = (user?.user_metadata as { full_name?: string } | undefined)?.full_name
    || user?.email
    || "Sin sesión";
  const initials = fullName
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "·";

  async function handleLogout() {
    await signOut();
    toast.success("Sesión cerrada");
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/70 shadow-[inset_0_-1px_0_0_hsl(var(--primary)/0.20)] md:gap-3 md:px-4">
      {isMobile ? (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Abrir menú"
          onClick={() => setOpenMobile(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
      ) : (
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
      )}

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden font-mono text-[11px] uppercase tracking-wider text-muted-foreground md:flex-initial"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span
              key={c.to}
              className={
                "flex items-center gap-1.5 " +
                (last ? "min-w-0 truncate" : "hidden md:flex")
              }
            >
              {last ? (
                <span className="truncate text-foreground">{c.label}</span>
              ) : (
                <Link to={c.to} className="transition-colors hover:text-foreground">
                  {c.label}
                </Link>
              )}
              {!last && <span className="opacity-50">›</span>}
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-muted-foreground md:px-3"
          >
            <Languages className="h-4 w-4" />
            <span className="hidden uppercase sm:inline">{locale}</span>
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
            {theme === "light" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" /> {t.settings.themeDark}
            {theme === "dark" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="mr-2 h-4 w-4" /> {t.settings.themeSystem}
            {theme === "system" && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-1 flex items-center gap-2 border-l border-border pl-2 md:pl-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
              <div className="hidden flex-col items-end leading-tight md:flex">
                <span className="text-xs font-medium text-foreground max-w-[160px] truncate">{fullName}</span>
                <span className="font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
                  {user ? "Sesión activa" : "Invitado"}
                </span>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/50 bg-surface-1 font-mono text-xs text-primary">
                {initials}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user ? (
              <>
                {isAdmin && (
                  <>
                    <DropdownMenuItem onClick={() => navigate("/admin/equipo")}>
                      <Users className="mr-2 h-4 w-4" /> Admin · Equipo
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/admin/zonas")}>
                      <Map className="mr-2 h-4 w-4" /> Admin · Zonas
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate("/admin/ia")}>
                      <Sparkles className="mr-2 h-4 w-4" /> Admin · IA
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={() => navigate("/login")}>
                Iniciar sesión
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

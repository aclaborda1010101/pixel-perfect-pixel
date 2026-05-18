import {
  LayoutDashboard, Building2, Users, TrendingUp,
  Inbox, FileText, PhoneCall,
  MessageSquare, Megaphone, ListChecks, BarChart3,
  Settings as SettingsIcon, Search,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { prefetchRoute } from "@/lib/prefetch";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/I18nProvider";
import { useCurrentRole } from "@/hooks/useCurrentRole";

type Item = { url: string; label: string; icon: any; beta?: boolean };

/** Línea fina evocando un acueducto: 5 arcos pequeños bajo el wordmark. */
function AqueductLine() {
  return (
    <svg
      viewBox="0 0 120 8"
      width="120"
      height="8"
      aria-hidden
      className="mt-1 opacity-60"
    >
      <path
        d="M2 7 Q 14 1 26 7 Q 38 1 50 7 Q 62 1 74 7 Q 86 1 98 7 Q 110 1 118 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AppSidebar() {
  const { t } = useI18n();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const queryClient = useQueryClient();
  const { role } = useCurrentRole();
  const isComercial = role === "comercial_zona";

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Hover/focus → precarga el chunk de la ruta y los datos de su primera página.
  const handlePrefetch = (path: string) => prefetchRoute(path, queryClient);

  const operativa: Item[] = isComercial ? [
    { url: "/comercial", label: "Inicio", icon: LayoutDashboard },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
  ] : [
    { url: "/", label: t.nav.home, icon: LayoutDashboard },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
    { url: "/inversores", label: t.nav.investors, icon: TrendingUp },
  ];
  const captacion: Item[] = isComercial ? [
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
  ] : [
    { url: "/leads", label: t.nav.leads, icon: Inbox },
    { url: "/notas-simples", label: t.nav.notasSimples, icon: FileText },
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
  ];
  const ia: Item[] = isComercial ? [
    { url: "/asistente", label: t.nav.assistant, icon: MessageSquare },
    { url: "/next-actions", label: t.nav.nextActions, icon: ListChecks },
    { url: "/productividad", label: t.nav.productividad, icon: BarChart3 },
  ] : [
    { url: "/asistente", label: t.nav.assistant, icon: MessageSquare },
    { url: "/mensajes", label: t.nav.mensajes, icon: Megaphone },
    { url: "/next-actions", label: t.nav.nextActions, icon: ListChecks },
    { url: "/productividad", label: t.nav.productividad, icon: BarChart3 },
  ];
  const cuenta: Item[] = isComercial ? [] : [
    { url: "/ajustes", label: t.nav.settings, icon: SettingsIcon },
  ];

  const renderGroup = (label: string, items: Item[]) => (
    <SidebarGroup className="px-2 py-1 md:py-1">
      {!collapsed && (
        <SidebarGroupLabel className="h-auto px-3 pb-2 pt-5 font-mono text-[12px] uppercase tracking-eyebrow text-sidebar-foreground/60 md:pb-1 md:pt-3 md:text-[10px] md:text-sidebar-foreground/50">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-0 divide-y divide-sidebar-border/40 md:gap-0.5 md:divide-y-0">
          {items.map((item) => {
            const active =
              item.url === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.url);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className={
                    "relative h-14 gap-3 rounded-[4px] px-3 text-[17px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:h-9 md:gap-2.5 md:text-[14px] " +
                    "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium " +
                    "data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1.5 data-[active=true]:before:bottom-1.5 data-[active=true]:before:w-[2px] data-[active=true]:before:bg-primary data-[active=true]:before:rounded-r-sm"
                  }
                >
                  <NavLink
                    to={item.url}
                    end={item.url === "/"}
                    onClick={handleNavClick}
                    onMouseEnter={() => handlePrefetch(item.url)}
                    onFocus={() => handlePrefetch(item.url)}
                    onTouchStart={() => handlePrefetch(item.url)}
                  >
                    <item.icon className="h-6 w-6 shrink-0 opacity-80 md:h-4 md:w-4" />
                    {!collapsed && (
                      <span className="flex flex-1 items-center justify-between">
                        <span>{item.label}</span>
                        {item.beta && (
                          <span className="ml-2 rounded-[3px] border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-eyebrow text-sidebar-foreground/60 md:px-1 md:py-0 md:text-[9px]">
                            {t.nav.betaBadge}
                          </span>
                        )}
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-5 md:py-4">
        <div className="flex items-start gap-3">
          {collapsed ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-primary/40 bg-sidebar-accent font-editorial text-base text-primary">
              A
            </div>
          ) : (
            <div className="flex min-w-0 flex-col leading-tight text-sidebar-foreground">
              <span className="font-editorial text-[22px] font-semibold tracking-[-0.005em] text-sidebar-foreground md:text-[19px]">
                Afflux Property
              </span>
              <AqueductLine />
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", metaKey: true })
              )
            }
            aria-label="Buscar"
            className="mt-4 flex h-12 w-full items-center gap-2.5 rounded-[4px] border border-sidebar-border bg-sidebar-accent/40 px-3 font-mono text-[13px] tabular-nums text-sidebar-foreground/60 transition-colors hover:border-primary/40 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground md:mt-3 md:h-9 md:gap-2 md:px-2.5 md:text-[11px]"
          >
            <Search className="h-4 w-4 shrink-0 opacity-70 md:h-3.5 md:w-3.5" />
            <span className="flex-1 truncate text-left normal-case tracking-normal">
              Buscar edificios, propietarios, llamadas…
            </span>
            <kbd className="hidden rounded-[3px] border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-sidebar-foreground/60 md:inline-flex">
              ⌘K
            </kbd>
          </button>
        )}
      </SidebarHeader>
      <SidebarContent className="bg-sidebar">
        {renderGroup(t.nav.groupOperativa, operativa)}
        {renderGroup(t.nav.groupCaptacion, captacion)}
        {renderGroup(t.nav.groupIA, ia)}
        {renderGroup(t.nav.groupCuenta, cuenta)}
      </SidebarContent>
    </Sidebar>
  );
}

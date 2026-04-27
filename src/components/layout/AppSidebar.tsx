import {
  Home, PhoneCall, PhoneOutgoing, Boxes, Users, Building2, Briefcase,
  GitMerge, MessageSquareDot, ShieldCheck, Settings as SettingsIcon, Search,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/I18nProvider";

type Item = { url: string; label: string; icon: any; beta?: boolean };

export function AppSidebar() {
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const pipeline: Item[] = [
    { url: "/", label: t.nav.home, icon: Home },
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
    { url: "/preparar-llamada", label: t.nav.newCall, icon: PhoneOutgoing },
  ];
  const cartera: Item[] = [
    { url: "/activos", label: t.nav.assets, icon: Boxes },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/inversores", label: t.nav.investors, icon: Briefcase, beta: true },
  ];
  const operaciones: Item[] = [
    { url: "/matching", label: t.nav.matching, icon: GitMerge, beta: true },
    { url: "/cadencias", label: t.nav.cadences, icon: MessageSquareDot, beta: true },
    { url: "/compliance", label: t.nav.compliance, icon: ShieldCheck },
  ];
  const cuenta: Item[] = [
    { url: "/ajustes", label: t.nav.settings, icon: SettingsIcon },
  ];

  const renderGroup = (label: string, items: Item[]) => (
    <SidebarGroup className="px-2 py-1">
      {!collapsed && (
        <SidebarGroupLabel className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-eyebrow text-sidebar-foreground/50">
          {label}
        </SidebarGroupLabel>
      )}
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
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
                    "relative h-8 rounded-[4px] px-3 text-[13px] text-sidebar-foreground/80 transition-colors hover:bg-surface-1 hover:text-sidebar-foreground " +
                    "data-[active=true]:bg-surface-1 data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium " +
                    "data-[active=true]:before:absolute data-[active=true]:before:left-0 data-[active=true]:before:top-1.5 data-[active=true]:before:bottom-1.5 data-[active=true]:before:w-[2px] data-[active=true]:before:bg-gold data-[active=true]:before:rounded-r-sm"
                  }
                >
                  <NavLink to={item.url} end={item.url === "/"}>
                    <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                    {!collapsed && (
                      <span className="flex flex-1 items-center justify-between">
                        <span>{item.label}</span>
                        {item.beta && (
                          <span className="ml-2 rounded-[3px] border border-sidebar-border px-1 font-mono text-[9px] uppercase tracking-eyebrow text-sidebar-foreground/60">
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
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-gold/40 bg-surface-1 font-editorial text-base text-gold">
            A
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="font-editorial text-base tracking-notarial text-sidebar-foreground">
                Afflux
              </span>
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-sidebar-foreground/50">
                Property
              </span>
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
            className="mt-3 flex h-9 w-full items-center gap-2 rounded-[4px] border border-sidebar-border bg-surface-1/40 px-2.5 font-mono text-[11px] tabular-nums text-sidebar-foreground/60 transition-colors hover:border-gold/40 hover:bg-surface-1/70 hover:text-sidebar-foreground"
          >
            <Search className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="flex-1 truncate text-left normal-case tracking-normal">
              Buscar activos, propietarios, llamadas…
            </span>
            <kbd className="rounded-[3px] border border-sidebar-border bg-sidebar px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-sidebar-foreground/60">
              ⌘K
            </kbd>
          </button>
        )}
      </SidebarHeader>
      <SidebarContent className="bg-sidebar">
        {renderGroup("Pipeline", pipeline)}
        {renderGroup("Cartera", cartera)}
        {renderGroup("Operaciones", operaciones)}
        {renderGroup("Cuenta", cuenta)}
      </SidebarContent>
    </Sidebar>
  );
}

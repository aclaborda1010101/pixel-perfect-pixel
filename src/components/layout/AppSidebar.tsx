import {
  Home, PhoneCall, PhoneOutgoing, Boxes, Users, Building2, Briefcase,
  GitMerge, MessageSquareDot, ShieldCheck, Settings as SettingsIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/I18nProvider";

type Item = { url: string; label: string; icon: any; beta?: boolean };

export function AppSidebar() {
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const today: Item[] = [
    { url: "/", label: t.nav.home, icon: Home },
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
    { url: "/preparar-llamada", label: t.nav.newCall, icon: PhoneOutgoing },
  ];
  const data: Item[] = [
    { url: "/activos", label: t.nav.assets, icon: Boxes },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/inversores", label: t.nav.investors, icon: Briefcase, beta: true },
  ];
  const gov: Item[] = [
    { url: "/matching", label: t.nav.matching, icon: GitMerge, beta: true },
    { url: "/cadencias", label: t.nav.cadences, icon: MessageSquareDot, beta: true },
    { url: "/compliance", label: t.nav.compliance, icon: ShieldCheck },
    { url: "/ajustes", label: t.nav.settings, icon: SettingsIcon },
  ];

  const renderGroup = (label: string, items: Item[]) => (
    <SidebarGroup>
      {!collapsed && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => {
            const active =
              item.url === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.url);
            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild isActive={active}>
                  <NavLink to={item.url} end={item.url === "/"}>
                    <item.icon className="h-4 w-4" />
                    {!collapsed && (
                      <span className="flex flex-1 items-center justify-between">
                        <span>{item.label}</span>
                        {item.beta && (
                          <Badge variant="outline" className="ml-2 h-4 px-1 text-[9px]">
                            {t.nav.betaBadge}
                          </Badge>
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
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            A
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-sidebar-foreground">{t.appName}</span>
              <span className="text-[10px] text-muted-foreground">{t.appTagline}</span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup(t.nav.groupToday, today)}
        {renderGroup(t.nav.groupData, data)}
        {renderGroup(t.nav.groupGov, gov)}
      </SidebarContent>
    </Sidebar>
  );
}

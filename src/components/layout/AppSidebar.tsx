import {
  LayoutDashboard,
  Users,
  Building2,
  Boxes,
  PhoneCall,
  Briefcase,
  GitMerge,
  ShieldCheck,
  MessageSquareDot,
  Settings,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/I18nProvider";

export function AppSidebar() {
  const { t } = useI18n();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();

  const items = [
    { url: "/", label: t.nav.dashboard, icon: LayoutDashboard },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/activos", label: t.nav.assets, icon: Boxes },
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
    { url: "/inversores", label: t.nav.investors, icon: Briefcase },
    { url: "/matching", label: t.nav.matching, icon: GitMerge },
    { url: "/compliance", label: t.nav.compliance, icon: ShieldCheck },
    { url: "/cadencias", label: t.nav.cadences, icon: MessageSquareDot },
    { url: "/ajustes", label: t.nav.settings, icon: Settings },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            A
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-sidebar-foreground">
                {t.appName}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {t.appTagline}
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel>{t.nav.dashboard}</SidebarGroupLabel>
          )}
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
                        {!collapsed && <span>{item.label}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
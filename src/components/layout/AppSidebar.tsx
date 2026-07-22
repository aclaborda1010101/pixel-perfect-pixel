import {
  LayoutDashboard, Building2, Users, TrendingUp,
  Inbox, FileText, PhoneCall,
  MessageSquare, Megaphone, ListChecks, BarChart3,
  Settings as SettingsIcon, Search, CheckSquare, UserCircle,
  MessagesSquare, Footprints, Target,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { prefetchRoute } from "@/lib/prefetch";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/i18n/I18nProvider";
import { useCurrentRole } from "@/hooks/useCurrentRole";

type Item = { url: string; label: string; icon: any; beta?: boolean; badge?: number };

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
  const isWhatsapp = role === "whatsapp";

  // Badge: nº de leads del bot todavía sin asignar (misma lógica que la página).
  const { data: unassignedCount = 0 } = useQuery({
    queryKey: ["oportunidades-unassigned-count"],
    enabled: !isWhatsapp,
    staleTime: 60_000,
    queryFn: async () => {
      const sb: any = supabase;
      const { data: setting } = await sb.from("app_settings").select("value")
        .eq("key", "oportunidades_zone_assignments").maybeSingle();
      const cfg = setting?.value ?? { zones: [] as { terms: string[] }[] };
      const { data: convs } = await sb.from("wa_conversations")
        .select("summary, qualification, wa_contacts(name)")
        .order("last_message_at", { ascending: false }).limit(200);
      let n = 0;
      for (const c of (convs ?? [])) {
        const hay = [c.qualification?.direccion_inmueble, c.qualification?.codigo_postal, c.qualification?.zona, c.wa_contacts?.name, c.summary]
          .filter(Boolean).join(" ").toLowerCase();
        const matched = (cfg.zones ?? []).some((z: any) =>
          (z.terms ?? []).some((t: string) => t && hay.includes(String(t).toLowerCase())));
        if (!matched) n++;
      }
      return n;
    },
  });

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Hover/focus → precarga el chunk de la ruta y los datos de su primera página.
  const handlePrefetch = (path: string) => prefetchRoute(path, queryClient);

  const operativa: Item[] = isWhatsapp ? [
    { url: "/whatsapp", label: "WhatsApp", icon: MessagesSquare },
  ] : isComercial ? [
    { url: "/comercial", label: "Inicio", icon: LayoutDashboard },
    { url: "/oportunidades", label: "Oportunidades", icon: Target, badge: unassignedCount },
    { url: "/comercial/edificios", label: "Scoring total", icon: Building2 },
    { url: "/comercial/tareas", label: "Tareas", icon: CheckSquare },
  ] : [
    { url: "/", label: t.nav.home, icon: LayoutDashboard },
    { url: "/oportunidades", label: "Oportunidades", icon: Target, badge: unassignedCount },
    { url: "/edificios", label: t.nav.buildings, icon: Building2 },
    { url: "/propietarios", label: t.nav.owners, icon: Users },
    { url: "/inversores", label: t.nav.investors, icon: TrendingUp },
  ];
  const captacion: Item[] = isComercial || isWhatsapp ? [] : [
    { url: "/leads", label: t.nav.leads, icon: Inbox },
    { url: "/notas-simples", label: t.nav.notasSimples, icon: FileText },
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
  ];
  const miTrabajo: Item[] = isComercial ? [
    { url: "/llamadas", label: t.nav.calls, icon: PhoneCall },
    { url: "/productividad", label: t.nav.productividad, icon: BarChart3 },
  ] : [];
  const ia: Item[] = isWhatsapp ? [] : isComercial ? [
    { url: "/asistente", label: t.nav.assistant, icon: MessageSquare },
  ] : [
    { url: "/asistente", label: t.nav.assistant, icon: MessageSquare },
    { url: "/whatsapp", label: "WhatsApp", icon: MessagesSquare },
    { url: "/mensajes", label: t.nav.mensajes, icon: Megaphone },
    { url: "/next-actions", label: t.nav.nextActions, icon: ListChecks },
    { url: "/productividad", label: t.nav.productividad, icon: BarChart3 },
  ];
  const cuenta: Item[] = isWhatsapp ? [] : isComercial ? [
    { url: "/comercial/cuenta", label: "Mi cuenta", icon: UserCircle },
  ] : [
    { url: "/revision-escaleras", label: "Revisión escaleras", icon: Footprints },
    { url: "/admin/proteccion-pgoum", label: "Validación PGOUM", icon: CheckSquare },
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
            // Exact match o sub-ruta con "/" delante. Sin esto, "/comercial"
            // se ilumina también estando en "/comercial/edificios".
            const active =
              location.pathname === item.url ||
              location.pathname.startsWith(item.url + "/");
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
                        {item.badge !== undefined && item.badge > 0 && (
                          <span className="ml-2 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground">
                            {item.badge}
                          </span>
                        )}
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
        {renderGroup(isWhatsapp ? "WhatsApp" : isComercial ? "Operativa" : t.nav.groupOperativa, operativa)}
        {isWhatsapp ? null : isComercial
          ? renderGroup("Mi trabajo", miTrabajo)
          : renderGroup(t.nav.groupCaptacion, captacion)}
        {isWhatsapp ? null : renderGroup(isComercial ? "Herramientas" : t.nav.groupIA, ia)}
        {isWhatsapp ? null : renderGroup(isComercial ? "Cuenta" : t.nav.groupCuenta, cuenta)}
      </SidebarContent>
    </Sidebar>
  );
}

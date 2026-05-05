import { NavLink, useLocation } from "react-router-dom";
import { Building2, Users, MessageSquare, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/edificios", label: "Edificios", icon: Building2, match: (p: string) => p.startsWith("/edificios") },
  { to: "/propietarios", label: "Propietarios", icon: Users, match: (p: string) => p.startsWith("/propietarios") },
  { to: "/asistente", label: "Asistente", icon: MessageSquare, match: (p: string) => p.startsWith("/asistente") },
  { to: "/ajustes", label: "Configuración", icon: SettingsIcon, match: (p: string) => p.startsWith("/ajustes") || p.startsWith("/configuracion") },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur shadow-[inset_0_1px_0_0_hsl(var(--primary)/0.25)] md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((it) => {
        const active = it.match(pathname);
        const Icon = it.icon;
        return (
          <NavLink
            key={it.to}
            to={it.to}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-mono uppercase tracking-eyebrow transition-colors",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {active && (
              <span className="absolute left-1/2 top-0 h-[2px] w-10 -translate-x-1/2 rounded-b-sm bg-primary" />
            )}
            <Icon className={cn("h-6 w-6", active ? "text-primary" : "")} strokeWidth={1.75} />
            <span>{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

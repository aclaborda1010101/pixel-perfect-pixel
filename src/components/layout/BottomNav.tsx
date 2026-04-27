import { NavLink, useLocation } from "react-router-dom";
import { Home, PhoneCall, Boxes, User } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Inicio", icon: Home, match: (p: string) => p === "/" },
  { to: "/llamadas", label: "Llamadas", icon: PhoneCall, match: (p: string) => p.startsWith("/llamadas") || p.startsWith("/preparar-llamada") || p.startsWith("/analizar-llamada") },
  { to: "/activos", label: "Cartera", icon: Boxes, match: (p: string) => p.startsWith("/activos") || p.startsWith("/edificios") || p.startsWith("/propietarios") || p.startsWith("/inversores") },
  { to: "/ajustes", label: "Cuenta", icon: User, match: (p: string) => p.startsWith("/ajustes") },
];

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-border bg-background/95 backdrop-blur shadow-[inset_0_1px_0_0_hsl(var(--gold)/0.25)] md:hidden"
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
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-mono uppercase tracking-eyebrow transition-colors",
              active ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {active && (
              <span className="absolute left-1/2 top-0 h-[2px] w-8 -translate-x-1/2 rounded-b-sm bg-gold" />
            )}
            <Icon className={cn("h-4 w-4", active ? "text-gold" : "")} />
            <span>{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

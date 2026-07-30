import { Building2, Newspaper, Star, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Iconografía de los tres conceptos que NO deben confundirse:
 *  - Propietario estrella (campaña junio 2026)  → persona + estrella
 *  - Edificio estrella (2+ escaleras / terciario) → edificio + estrella
 *  - Revista recibida → periódico (nunca un sobre)
 */

type IconProps = { className?: string; title?: string };

function Stacked({
  Base,
  className,
  title,
  starClass,
}: IconProps & { Base: typeof User; starClass?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)} title={title}>
      <Base className="h-full w-full" />
      <Star
        className={cn(
          "absolute -bottom-[1px] -right-[2px] h-[55%] w-[55%] fill-current stroke-[2.5]",
          starClass,
        )}
      />
    </span>
  );
}

export function OwnerStarIcon({ className, title = "Propietario estrella — campaña junio 2026" }: IconProps) {
  return <Stacked Base={User} className={cn("h-4 w-4 text-amber-400", className)} title={title} />;
}

export function BuildingStarIcon({ className, title = "Edificio estrella" }: IconProps) {
  return <Stacked Base={Building2} className={cn("h-4 w-4 text-sky-400", className)} title={title} />;
}

export function RevistaIcon({
  className,
  title = "Recibió la revista de Afflux (junio 2026)",
}: IconProps) {
  return (
    <span className={cn("inline-flex shrink-0", className)} title={title}>
      <Newspaper className="h-4 w-4 text-emerald-400" />
    </span>
  );
}

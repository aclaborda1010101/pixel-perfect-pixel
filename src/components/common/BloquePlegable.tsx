import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

/** Bloque de contenido plegable, cerrado por defecto. Solo presentación. */
export function BloquePlegable({ label = "Más detalles", defaultOpen = false, children, className }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Ocultar detalles" : label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
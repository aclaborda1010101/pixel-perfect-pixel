import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoBanderaInterlocutor } from "@/lib/interlocutor";

/** Bandera clara y en lenguaje llano del interlocutor activo del edificio. */
export function InterlocutorFlag({
  nombre,
  compact = false,
  className,
}: {
  nombre?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const texto = textoBanderaInterlocutor(nombre);
  return (
    <span
      title={texto}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning-soft/40 px-2 py-0.5 text-warning",
        compact ? "text-[11px]" : "text-xs",
        className,
      )}
    >
      <Flag className="h-3.5 w-3.5 shrink-0" />
      {compact ? `Interlocutor: ${(nombre ?? "").trim() || "designado"}` : texto}
    </span>
  );
}

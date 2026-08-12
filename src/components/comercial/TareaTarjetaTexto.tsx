import { parseTarjetaTarea } from "@/lib/tarjetaTarea";
import { cn } from "@/lib/utils";

/** Pinta el texto de la tarea en bloques legibles: encabezado y contenido debajo. */
export function TareaTarjetaTexto({
  description,
  className,
}: {
  description?: string | null;
  className?: string;
}) {
  const { intro, secciones } = parseTarjetaTarea(description);
  if (intro.length === 0 && secciones.length === 0) return null;
  return (
    <div className={cn("mt-2 space-y-3 text-xs text-muted-foreground", className)}>
      {intro.length > 0 && (
        <div className="space-y-1">
          {intro.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}
      {secciones.map((s) => (
        <div key={s.titulo} className="space-y-1">
          <div className="font-semibold text-foreground">{s.titulo}</div>
          {s.lineas.map((l, i) => (
            <p key={i} className="leading-relaxed">
              {l}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

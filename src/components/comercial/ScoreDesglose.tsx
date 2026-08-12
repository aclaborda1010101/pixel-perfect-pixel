import { cn } from "@/lib/utils";

export const AYUDA_SCORE =
  "El total combina la calidad del edificio (60%) y lo completas que están las fichas de sus propietarios (40%): teléfonos, llamadas y datos";

function redondea(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function Barra({ valor, tono }: { valor: number | null; tono: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-1">
      <div
        className={cn("h-full transition-all duration-500", tono)}
        style={{ width: `${Math.max(2, Math.min(100, valor ?? 0))}%` }}
      />
    </div>
  );
}

/**
 * Muestra, en lenguaje llano, de dónde sale el número total del edificio.
 * No calcula nada: sólo presenta los valores que ya vienen del sistema.
 */
export function ScoreDesglose({
  edificio,
  propietarios,
  total,
  aviso,
  className,
}: {
  edificio: unknown;
  propietarios: unknown;
  total: unknown;
  aviso?: string | null;
  className?: string;
}) {
  const e = redondea(edificio);
  const p = redondea(propietarios);
  const t = redondea(total);
  if (e == null && p == null) return null;

  return (
    <div className={cn("space-y-2", className)} title={AYUDA_SCORE}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          Edificio <span className="font-semibold tabular-nums text-foreground">{e ?? "—"}</span>
        </span>
        <span aria-hidden>·</span>
        <span>
          Propietarios{" "}
          <span className="font-semibold tabular-nums text-foreground">{p ?? "—"}</span>
        </span>
        <span aria-hidden>·</span>
        <span>
          Total <span className="font-semibold tabular-nums text-foreground">{t ?? "—"}</span>
        </span>
      </div>
      <div className="grid max-w-xs grid-cols-2 gap-2">
        <Barra valor={e} tono="bg-sky-500/70" />
        <Barra valor={p} tono="bg-emerald-500/70" />
      </div>
      <p className="text-xs text-muted-foreground">{AYUDA_SCORE}.</p>
      {aviso && <p className="text-xs text-muted-foreground">{aviso}</p>}
      {p != null && p < 50 && (
        <p className="text-xs text-amber-400">
          Sube este número completando teléfonos y registrando llamadas de los propietarios.
        </p>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";

export const AYUDA_DERECHOS =
  "La propiedad (pleno + nuda) es la que cuenta para cuotas y tareas; el usufructo es el derecho de uso — típico de herencias";

export type DerechoTag = { clave: "pleno" | "nuda" | "usufructo"; etiqueta: string; valor: number };

export type GrupoDerecho = "propiedad" | "usufructo" | "sin_derecho";

/** Texto por defecto de la chapita de influenciador. */
export const TEXTO_INFLUENCIADOR =
  "No consta en la nota simple: posible familiar o allegado que puede influir en la negociación";

/** ¿Este propietario está marcado como influenciador en el edificio? */
export function esInfluenciador(o: { es_influencer?: unknown }): boolean {
  return o?.es_influencer === true;
}

/** Chapita discreta, con color propio distinto al de los derechos. */
export function InfluenciadorTag({
  owner,
  className,
}: {
  owner: { es_influencer?: unknown; influencer_reason?: unknown };
  className?: string;
}) {
  if (!esInfluenciador(owner)) return null;
  const motivo = String(owner?.influencer_reason ?? "").trim();
  return (
    <span
      title={motivo || TEXTO_INFLUENCIADOR}
      className={cn(
        "rounded-[4px] border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600",
        className,
      )}
    >
      Influenciador
    </span>
  );
}

/**
 * Clasifica a un titular según lo que consta a su nombre en la nota:
 * - propiedad: tiene pleno y/o nuda
 * - usufructo: sólo usufructo
 * - sin_derecho: no consta ningún derecho
 */
export function grupoDerecho(o: {
  pct_pleno?: unknown;
  pct_nuda?: unknown;
  pct_usufructo?: unknown;
  pct_propiedad?: unknown;
  pct_invalido?: unknown;
}): GrupoDerecho {
  const pleno = aNumero(o?.pct_pleno);
  const nuda = aNumero(o?.pct_nuda);
  const propiedad = o?.pct_invalido ? null : aNumero(o?.pct_propiedad);
  if (pleno != null || nuda != null || propiedad != null) return "propiedad";
  if (aNumero(o?.pct_usufructo) != null) return "usufructo";
  return "sin_derecho";
}

function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatea(n: number): string {
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Devuelve sólo las etiquetas con valor. No calcula nada: presenta los valores
 * que ya vienen del sistema (pct_pleno, pct_nuda, pct_usufructo).
 */
export function derechoTags(o: {
  pct_pleno?: unknown;
  pct_nuda?: unknown;
  pct_usufructo?: unknown;
}): DerechoTag[] {
  const out: DerechoTag[] = [];
  const pleno = aNumero(o?.pct_pleno);
  const nuda = aNumero(o?.pct_nuda);
  const usu = aNumero(o?.pct_usufructo);
  if (pleno != null) out.push({ clave: "pleno", etiqueta: `Pleno ${formatea(pleno)}%`, valor: pleno });
  if (nuda != null) out.push({ clave: "nuda", etiqueta: `Nuda ${formatea(nuda)}%`, valor: nuda });
  if (usu != null) out.push({ clave: "usufructo", etiqueta: `Usufructo ${formatea(usu)}%`, valor: usu });
  return out;
}

const ESTILO: Record<DerechoTag["clave"], string> = {
  pleno: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  nuda: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  usufructo: "border-violet-500/40 bg-violet-500/10 text-violet-500",
};

const TITULO: Record<DerechoTag["clave"], string> = {
  pleno: "Pleno dominio — cuenta como propiedad",
  nuda: "Nuda propiedad — cuenta como propiedad",
  usufructo: "Usufructo — derecho de uso, no cuenta como propiedad",
};

export function DerechoTags({
  owner,
  className,
}: {
  owner: { pct_pleno?: unknown; pct_nuda?: unknown; pct_usufructo?: unknown };
  className?: string;
}) {
  const tags = derechoTags(owner);
  if (tags.length === 0) return null;
  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-1", className)} title={AYUDA_DERECHOS}>
      {tags.map((t) => (
        <span
          key={t.clave}
          title={`${TITULO[t.clave]}. ${AYUDA_DERECHOS}`}
          className={cn(
            "rounded-[4px] border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            ESTILO[t.clave],
          )}
        >
          {t.etiqueta}
        </span>
      ))}
    </div>
  );
}

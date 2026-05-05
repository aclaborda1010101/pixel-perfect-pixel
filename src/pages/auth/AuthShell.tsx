import type { ReactNode } from "react";
import { Eyebrow } from "@/components/common/Eyebrow";

/** Línea fina evocando un acueducto Afflux. */
function AqueductLine() {
  return (
    <svg viewBox="0 0 160 10" width="160" height="10" aria-hidden className="opacity-70">
      <path
        d="M2 9 Q 18 1 34 9 Q 50 1 66 9 Q 82 1 98 9 Q 114 1 130 9 Q 146 1 158 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Split-screen sobrio para Login / Recuperar contraseña.
 * Panel izquierdo: marca Afflux Property sobre fondo --brand grafito.
 * Panel derecho: superficie del formulario.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-background md:grid-cols-[5fr_6fr]">
      {/* Marca compacta mobile (<768px) */}
      <div className="relative overflow-hidden border-b border-border-faint bg-brand p-6 text-brand-foreground md:hidden">
        <div className="relative z-10 space-y-3">
          <div className="font-editorial text-2xl font-semibold tracking-[-0.005em] text-brand-foreground">
            Afflux Property
          </div>
          <div className="font-mono text-[11px] uppercase tracking-eyebrow text-brand-foreground/70">
            Inteligencia operativa para Afflux Property
          </div>
          <div className="text-primary"><AqueductLine /></div>
        </div>
      </div>

      {/* Panel marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand p-12 text-brand-foreground md:flex">
        <div className="relative z-10 space-y-2">
          <div className="font-editorial text-3xl font-semibold tracking-[-0.005em]">
            Afflux Property
          </div>
          <div className="text-primary"><AqueductLine /></div>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <Eyebrow className="text-primary/70">Detectar · Desbloquear · Estructurar · Liquidar</Eyebrow>
          <h1 className="font-editorial text-4xl font-normal leading-tight tracking-[-0.005em]">
            Inteligencia operativa para el patrimonio inmobiliario complejo de Madrid.
          </h1>
          <div className="h-px w-16 bg-primary/60" />
        </div>

        <div className="relative z-10">
          <Eyebrow className="text-brand-foreground/40">Afflux Property · Madrid · 2026</Eyebrow>
        </div>
      </aside>

      {/* Panel formulario */}
      <main className="flex items-center justify-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

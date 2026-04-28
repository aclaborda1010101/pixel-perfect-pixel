import type { ReactNode } from "react";
import { Eyebrow } from "@/components/common/Eyebrow";

/**
 * Split-screen notarial para Login / Recuperar contraseña.
 * Panel izquierdo: marca Afflux Property sobre fondo --brand (marino).
 * Panel derecho: superficie del formulario.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen w-full grid-cols-1 bg-background md:grid-cols-[5fr_6fr]">
      {/* Marca compacta mobile (<768px) */}
      <div className="relative overflow-hidden border-b border-border-faint bg-brand p-6 text-brand-foreground md:hidden">
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,hsl(var(--gold))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--gold))_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-gold/60 bg-gold/10 font-mono text-sm text-gold">
              A
            </div>
            <div className="font-mono text-[11px] uppercase tracking-eyebrow text-brand-foreground/80">
              Afflux Property
            </div>
          </div>
          <p className="font-editorial text-base leading-snug tracking-notarial text-brand-foreground">
            Patrimonio inmobiliario de Madrid, con la sobriedad que merece.
          </p>
          <div className="h-px w-12 bg-gold/60" />
        </div>
      </div>

      {/* Panel marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand p-12 text-brand-foreground md:flex">
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,hsl(var(--gold))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--gold))_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-gold/60 bg-gold/10 font-mono text-sm text-gold">
              A
            </div>
            <div className="leading-tight">
              <div className="font-editorial text-lg tracking-notarial">Afflux Property</div>
              <Eyebrow className="text-gold/80">Property</Eyebrow>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-6">
          <Eyebrow className="text-gold/70">15+ años · Equipo jurídico propio · Notario de confianza</Eyebrow>
          <h1 className="font-editorial text-4xl font-normal leading-tight tracking-notarial">
            Gestiona el patrimonio inmobiliario de Madrid con la sobriedad que merece.
          </h1>
          <div className="h-px w-16 bg-gold/60" />
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

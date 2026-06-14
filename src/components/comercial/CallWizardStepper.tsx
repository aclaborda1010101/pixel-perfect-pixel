import { CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Preparación", hint: "Brief + Voss pre-llamada" },
  { id: 2, label: "Llamada finalizada", hint: "Analizar grabación" },
  { id: 3, label: "Resultado", hint: "Outcome + análisis post" },
];

export function CallWizardStepper({ paso, onJump }: { paso: number; onJump?: (n: number) => void }) {
  return (
    <ol className="flex w-full items-stretch gap-2 rounded-[6px] border border-border-faint bg-surface-1/40 p-1.5">
      {STEPS.map((s, idx) => {
        const done = paso > s.id;
        const active = paso === s.id;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => onJump?.(s.id)}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-[4px] px-3 py-2 text-left transition",
                active && "bg-gold-soft/60 text-foreground",
                done && !active && "text-foreground hover:bg-surface-1",
                !active && !done && "text-muted-foreground hover:bg-surface-1",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                  active && "border-gold bg-gold/20 text-gold",
                  done && !active && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                  !active && !done && "border-border-faint",
                )}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : s.id}
              </span>
              <span className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-eyebrow opacity-80">Paso {s.id}</div>
                <div className="truncate text-sm font-medium">{s.label}</div>
                <div className="truncate text-[11px] text-muted-foreground">{s.hint}</div>
              </span>
            </button>
            {idx < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground/40" />}
          </li>
        );
      })}
    </ol>
  );
}
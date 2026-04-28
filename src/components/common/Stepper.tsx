import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[];
  current: number;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "flex flex-col gap-3 border-b border-border-faint pb-4 md:flex-row md:items-center",
        className,
      )}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={i} className="flex items-center gap-3 md:gap-3">
            <div
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] tabular-nums",
                done && "border-gold bg-gold text-gold-foreground",
                active && "border-gold bg-gold-soft/60 text-gold",
                !done && !active && "border-border-faint bg-transparent text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </div>
            <span
              className={cn(
                "flex-1 font-mono text-[10px] uppercase tracking-eyebrow md:flex-none",
                active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/60",
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "hidden h-px w-6 md:block",
                  done ? "bg-gold/60" : "bg-border-faint",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

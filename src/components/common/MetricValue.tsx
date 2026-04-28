import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<Size, string> = {
  sm: "text-xl md:text-lg",
  md: "text-3xl md:text-2xl",
  lg: "text-[2.25rem] leading-10 md:text-3xl md:leading-9",
  xl: "text-[2.5rem] leading-[2.75rem] md:text-4xl md:leading-none",
};

export function MetricValue({
  children,
  unit,
  className,
  size = "lg",
}: {
  children: ReactNode;
  unit?: ReactNode;
  className?: string;
  size?: Size;
}) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums tracking-notarial text-foreground",
        sizeMap[size],
        className,
      )}
    >
      {children}
      {unit && (
        <span className="ml-1 text-[0.6em] font-normal text-muted-foreground">
          {unit}
        </span>
      )}
    </span>
  );
}

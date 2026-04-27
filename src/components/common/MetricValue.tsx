import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const sizeMap: Record<Size, string> = {
  sm: "text-lg",
  md: "text-2xl",
  lg: "text-3xl",
  xl: "text-4xl",
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

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({
  children,
  className,
  as: Tag = "p",
}: {
  children: ReactNode;
  className?: string;
  as?: "p" | "span" | "div";
}) {
  return (
    <Tag
      className={cn(
        "font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

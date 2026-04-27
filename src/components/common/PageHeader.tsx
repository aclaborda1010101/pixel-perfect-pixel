import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-border-faint pb-4">
      <div className="space-y-1">
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
import type { ReactNode } from "react";
import { useRegisterPageTitle } from "@/components/layout/PageTitleContext";

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
  useRegisterPageTitle(title);
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-border-faint pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2 className="font-editorial text-2xl font-normal tracking-notarial text-foreground md:text-3xl break-words">
          {title}
        </h2>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 md:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </div>
  );
}
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
    <div className="mb-6 flex flex-col gap-4 border-b border-border-faint pb-5 pt-1 md:mb-6 md:flex-row md:items-end md:justify-between md:pb-4 md:pt-0">
      <div className="min-w-0 space-y-1.5 md:space-y-1">
        {eyebrow && (
          <p className="font-mono text-[12px] uppercase tracking-eyebrow text-muted-foreground md:text-[11px]">
            {eyebrow}
          </p>
        )}
        <h2 className="font-editorial text-[28px] leading-tight font-normal tracking-notarial text-foreground md:text-3xl break-words">
          {title}
        </h2>
        {subtitle && (
          <p className="text-base md:text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 [&>*]:min-h-[44px] [&>*]:flex-1 md:[&>*]:min-h-0 md:[&>*]:flex-none">
          {actions}
        </div>
      )}
    </div>
  );
}
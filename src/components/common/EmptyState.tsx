import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Inbox } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  ctaLabel,
  ctaTo,
  onCta,
  className,
  children,
}: {
  icon?: any;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaTo?: string;
  onCta?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={cn("flex flex-col items-center justify-center gap-4 px-6 py-16 text-center border-dashed", className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-border-faint bg-surface-1/40 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1.5">
        <p className="font-editorial text-lg tracking-notarial text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground leading-relaxed">{description}</p>}
      </div>
      {ctaLabel && ctaTo && (
        <Button asChild size="sm" className="mt-2">
          <Link to={ctaTo}>{ctaLabel}</Link>
        </Button>
      )}
      {ctaLabel && onCta && !ctaTo && (
        <Button size="sm" className="mt-2" onClick={onCta}>{ctaLabel}</Button>
      )}
      {children}
    </Card>
  );
}
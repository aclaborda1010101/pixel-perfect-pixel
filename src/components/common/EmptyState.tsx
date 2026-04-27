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
    <Card className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
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
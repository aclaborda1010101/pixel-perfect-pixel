import { Link } from "react-router-dom";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export type Crumb = { label: string; to?: string };

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <BreadcrumbItem key={i}>
              {last || !c.to ? (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              ) : (
                <>
                  <BreadcrumbLink asChild>
                    <Link to={c.to}>{c.label}</Link>
                  </BreadcrumbLink>
                  <BreadcrumbSeparator />
                </>
              )}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
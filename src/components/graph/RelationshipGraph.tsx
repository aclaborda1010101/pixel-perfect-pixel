import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Building2, Users2, Briefcase, FileText } from "lucide-react";

export type GraphNode = {
  id: string;
  label: string;
  sublabel?: string;
  kind: "owner" | "building" | "company" | "nota";
  href?: string;
  badge?: string;
};

export type GraphCenter = {
  label: string;
  sublabel?: string;
  kind: "owner" | "building" | "company";
};

const KIND_META: Record<GraphNode["kind"], { icon: any; color: string; bg: string; label: string }> = {
  owner:    { icon: Users2,    color: "text-primary",          bg: "bg-primary/10 border-primary/30",  label: "Propietario" },
  building: { icon: Building2, color: "text-gold",             bg: "bg-gold-soft/40 border-gold/40",   label: "Edificio" },
  company:  { icon: Briefcase, color: "text-foreground",       bg: "bg-muted/40 border-border",        label: "Empresa" },
  nota:     { icon: FileText,  color: "text-muted-foreground", bg: "bg-card border-border",            label: "Nota simple" },
};

function NodeCard({ node }: { node: GraphNode }) {
  const meta = KIND_META[node.kind];
  const Icon = meta.icon;
  const inner = (
    <div className={cn(
      "group flex items-start gap-2 rounded-[3px] border px-3 py-2 text-xs transition",
      meta.bg,
      node.href && "hover:border-foreground/30 hover:shadow-sm cursor-pointer"
    )}>
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.color)} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{node.label}</div>
        {node.sublabel && (
          <div className="truncate text-[10px] text-muted-foreground mt-0.5">{node.sublabel}</div>
        )}
      </div>
      {node.badge && (
        <span className="rounded-[2px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-muted-foreground">
          {node.badge}
        </span>
      )}
    </div>
  );
  return node.href ? <Link to={node.href}>{inner}</Link> : inner;
}

function Section({ title, count, nodes, emptyHint }: { title: string; count: number; nodes: GraphNode[]; emptyHint?: string }) {
  if (count === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h4 className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{title}</h4>
          <span className="font-mono text-[10px] text-muted-foreground">0</span>
        </div>
        <div className="rounded-[3px] border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
          {emptyHint ?? "Sin vínculos"}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{title}</h4>
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      </div>
      <div className="grid gap-1.5">
        {nodes.slice(0, 20).map((n) => <NodeCard key={n.id} node={n} />)}
        {count > 20 && (
          <div className="text-[10px] text-muted-foreground text-center pt-1">… y {count - 20} más</div>
        )}
      </div>
    </div>
  );
}

export function RelationshipGraph({
  center,
  buildings = [],
  owners = [],
  companies = [],
  notas = [],
}: {
  center: GraphCenter;
  buildings?: GraphNode[];
  owners?: GraphNode[];
  companies?: GraphNode[];
  notas?: GraphNode[];
}) {
  const centerMeta = KIND_META[center.kind];
  const CenterIcon = centerMeta.icon;

  return (
    <div className="space-y-6">
      <div className="rounded-[3px] border border-foreground/20 bg-gradient-to-br from-card to-muted/20 p-4">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-[3px] border p-2", centerMeta.bg)}>
            <CenterIcon className={cn("h-5 w-5", centerMeta.color)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">{centerMeta.label}</div>
            <div className="truncate text-lg font-semibold">{center.label}</div>
            {center.sublabel && <div className="truncate text-xs text-muted-foreground">{center.sublabel}</div>}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {center.kind !== "building" && (
          <Section title="Edificios" count={buildings.length} nodes={buildings} emptyHint="Sin edificios vinculados" />
        )}
        {center.kind !== "owner" && (
          <Section title="Propietarios" count={owners.length} nodes={owners} emptyHint="Sin propietarios vinculados" />
        )}
        {center.kind !== "company" && (
          <Section title="Empresas" count={companies.length} nodes={companies} emptyHint="Sin empresas vinculadas" />
        )}
        <Section title="Notas simples" count={notas.length} nodes={notas} emptyHint="Sin notas simples" />
      </div>
    </div>
  );
}

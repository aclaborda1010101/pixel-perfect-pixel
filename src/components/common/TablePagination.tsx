import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  page: number;
  pageSize: number;
  totalCount: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
};

/** Paginador estándar Prev/Next + selector tamaño de página + total. */
export function TablePagination({
  page, pageSize, totalCount, loading, onPageChange, onPageSizeChange,
  pageSizes = [50, 100, 200],
}: Props) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(totalCount, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-faint px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
        {loading ? "Cargando…" : `Mostrando ${from.toLocaleString()}–${to.toLocaleString()} de ${totalCount.toLocaleString()}`}
      </div>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pageSizes.map((s) => <SelectItem key={s} value={String(s)}>{s} / pág</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => onPageChange(Math.max(0, page - 1))}>
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </Button>
        <span className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
          Página {page + 1} / {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page + 1 >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
          Siguiente <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
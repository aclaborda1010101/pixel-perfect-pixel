import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FilterOp = "eq" | "neq" | "ilike" | "gte" | "lte" | "is" | "in" | "not.is";
export type Filter = { column: string; op: FilterOp; value: any };

export type UseTableQueryOpts = {
  /** Tabla o vista de Supabase */
  table: string;
  /** Columnas a seleccionar (default *) */
  select?: string;
  /** Filtros server-side */
  filters?: Filter[];
  /** Buscador full-text aplicado con OR ilike sobre las columnas dadas */
  search?: { term: string; columns: string[] };
  /** Ordenación */
  order?: { column: string; ascending?: boolean };
  /** Paginación */
  page: number;
  pageSize: number;
  /** Habilitar/deshabilitar la carga */
  enabled?: boolean;
};

export type UseTableQueryResult<T> = {
  rows: T[];
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

/**
 * Hook genérico para listar cualquier tabla/vista con:
 *   - count: exact (sin caer en el límite 1000 de PostgREST)
 *   - range() server-side
 *   - filtros (eq/neq/ilike/gte/lte/is/in/not.is)
 *   - búsqueda OR ilike multi-columna
 *   - orden configurable
 * Toda vista nueva debe usar este hook.
 */
export function useTableQuery<T = any>({
  table, select = "*", filters = [], search, order, page, pageSize, enabled = true,
}: UseTableQueryOpts): UseTableQueryResult<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const filtersKey = JSON.stringify(filters);
  const searchKey = search ? `${search.term}|${search.columns.join(",")}` : "";
  const orderKey = order ? `${order.column}|${order.ascending}` : "";

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      let q: any = (supabase.from(table as any) as any).select(select, { count: "exact" });

      for (const f of filters) {
        if (f.value === undefined || f.value === null || f.value === "" || f.value === "all") continue;
        switch (f.op) {
          case "eq":      q = q.eq(f.column, f.value); break;
          case "neq":     q = q.neq(f.column, f.value); break;
          case "ilike":   q = q.ilike(f.column, `%${String(f.value).replace(/[%,]/g, "")}%`); break;
          case "gte":     q = q.gte(f.column, f.value); break;
          case "lte":     q = q.lte(f.column, f.value); break;
          case "is":      q = q.is(f.column, f.value); break;
          case "in":      q = q.in(f.column, Array.isArray(f.value) ? f.value : [f.value]); break;
          case "not.is":  q = q.not(f.column, "is", f.value); break;
        }
      }

      if (search && search.term?.trim() && search.columns.length) {
        const s = search.term.trim().replace(/[%,]/g, "");
        const orClause = search.columns.map((c) => `${c}.ilike.%${s}%`).join(",");
        q = q.or(orClause);
      }

      if (order) q = q.order(order.column, { ascending: order.ascending ?? false, nullsFirst: false });

      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error: err } = await q.range(from, to);
      if (err) throw err;
      setRows((data ?? []) as T[]);
      setTotalCount(count ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando datos");
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, select, filtersKey, searchKey, orderKey, page, pageSize, enabled, tick]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasMore = (page + 1) * pageSize < totalCount;

  return {
    rows, totalCount, totalPages, hasMore, loading, error,
    refetch: () => setTick((t) => t + 1),
  };
}
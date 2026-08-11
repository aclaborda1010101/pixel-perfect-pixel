import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * Regresión funcional: un comercial con CERO edificios activos debe seguir
 * viendo sus tareas V5 y manuales. Se comprueba con render real y mocks del
 * cliente, no leyendo el fuente.
 */
const tableCalls: string[] = [];
const rows: Record<string, any[]> = {
  building_assignments: [],
  profiles: [{ full_name: "Ana Ruiz" }],
  building_feedback: [],
  building_tasks: [
    { id: "t1", title: "Cadencia vencida", priority: "high", task_type: "call_queue", task_key: "v5:2026-08-10:T-04:o1", status: "pending", building_id: "b1" },
    { id: "t2", title: "Tarea mía", priority: "medium", task_type: "manual", task_key: null, status: "pending", building_id: "b1" },
    { id: "t3", title: "Ruido legacy", priority: "high", task_type: "auto", task_key: "call_queue:2026-01-01:o9", status: "pending", building_id: "b1" },
  ],
};

function builder(table: string) {
  const data = rows[table] ?? [];
  const result = { data, error: null, count: data.length };
  const q: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      if (prop === "maybeSingle" || prop === "single") return async () => ({ data: data[0] ?? null, error: null });
      return () => q;
    },
  });
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => { tableCalls.push(t); return builder(t); } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/hooks/useCurrentRole", () => ({ useCurrentRole: () => ({ role: "comercial_zona", loading: false }) }));
vi.mock("@/components/comercial/ColaHoyCard", () => ({ ColaHoyCard: () => null }));

import Dashboard from "@/pages/comercial/Dashboard";
import { fetchVisibleUserTasks } from "@/lib/dashboardTasks";

describe("dashboard comercial · tareas visibles sin edificios", () => {
  beforeEach(() => { tableCalls.length = 0; });

  it("con 0 edificios activos se consulta building_tasks y las tareas V5/manual se ven", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText("Cadencia vencida")).toBeInTheDocument());
    // La llamada a la tabla de tareas se ejecuta pese al early return por 0 edificios.
    expect(tableCalls).toContain("building_tasks");
    expect(screen.getByText("Tarea mía")).toBeInTheDocument();
    // El ruido legacy nunca aparece.
    expect(screen.queryByText("Ruido legacy")).toBeNull();
    // Y no hay edificios asignados.
    expect(screen.getByText(/Aún no tienes edificios asignados/)).toBeInTheDocument();
  });

  it("el loader filtra en servidor y en cliente", async () => {
    const calls: any[] = [];
    const q: any = {
      select: () => q, eq: () => q, in: () => q,
      or: (f: string) => { calls.push(f); return q; },
      order: () => Promise.resolve({ data: rows.building_tasks, error: null }),
    };
    const tasks = await fetchVisibleUserTasks({ from: () => q } as any, "u1");
    expect(calls[0]).toContain("task_type.eq.manual");
    expect(tasks.map((t: any) => t.id)).toEqual(["t1", "t2"]);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductividadTab } from "@/components/gestor/ProductividadTab";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
vi.mock("@/hooks/useHorarioLaboral", () => ({ useHorarioLaboral: () => ({ horario: undefined }) }));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProductividadTab />
    </QueryClientProvider>,
  );
}

describe("maqueta de productividad: render", () => {
  it("muestra el aviso, los seis indicadores y la comparativa", () => {
    renderTab();
    expect(screen.getByText(/Vista de diseño/)).toBeTruthy();
    expect(screen.getByText("Cuadro de rentas y vencimiento de contratos")).toBeTruthy();
    expect(screen.getAllByText("25%").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jesús/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/David/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Importes orientativos/)).toBeTruthy();
    expect(screen.getByText(/cita textual del propietario/)).toBeTruthy();
  });
});

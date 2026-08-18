/**
 * Camino real que fallaba: responsable de ventas entra en su panel y pulsa el
 * acceso al Orquestador. El guard le devolvía a /gestor-comerciales (pantalla
 * "en blanco" desde su punto de vista). Aquí se comprueba el camino completo.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { user: { id: "sm" } }, loading: false }) }));
vi.mock("@/hooks/useCurrentRole", () => ({ useCurrentRole: () => ({ role: "sales_manager", loading: false }) }));
vi.mock("@/hooks/useMustChangePassword", () => ({
  useMustChangePassword: () => ({ mustChange: false, loading: false, error: null, refetch: vi.fn() }),
}));

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

function PanelStub() {
  return <Link to="/correcciones">Orquestador · 69 correcciones pendientes de revisar</Link>;
}

describe("acceso al Orquestador desde el panel del responsable", () => {
  it("el responsable pulsa el enlace y la pantalla carga (no redirige a su panel)", async () => {
    render(
      <MemoryRouter initialEntries={["/gestor-comerciales"]}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/gestor-comerciales" element={<PanelStub />} />
            <Route path="/correcciones" element={<h1>Orquestador</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: /Orquestador/ }));
    expect(await screen.findByRole("heading", { name: "Orquestador" })).toBeTruthy();
  });
});

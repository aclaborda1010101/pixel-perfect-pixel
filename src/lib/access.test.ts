import { describe, it, expect } from "vitest";
import { decideAccess, canAccessGestor, GESTOR_PATH, PASSWORD_PATH } from "./access";

describe("canAccessGestor", () => {
  it("permite admin y sales_manager", () => {
    expect(canAccessGestor("admin")).toBe(true);
    expect(canAccessGestor("sales_manager")).toBe(true);
  });
  it("bloquea comerciales y otros", () => {
    for (const r of ["comercial_zona", "captacion", "viewer", "whatsapp", null] as const) {
      expect(canAccessGestor(r)).toBe(false);
    }
  });
});

describe("decideAccess", () => {
  it("sales_manager entra en /gestor-comerciales", () => {
    expect(decideAccess({ role: "sales_manager", pathname: GESTOR_PATH })).toEqual({ type: "allow" });
  });
  it("comercial no entra en /gestor-comerciales", () => {
    expect(decideAccess({ role: "comercial_zona", pathname: GESTOR_PATH })).toEqual({ type: "redirect", to: "/" });
  });
  it("sales_manager no entra en /admin ni subrutas", () => {
    expect(decideAccess({ role: "sales_manager", pathname: "/admin" })).toEqual({ type: "redirect", to: GESTOR_PATH });
    expect(decideAccess({ role: "sales_manager", pathname: "/admin/sync" })).toEqual({ type: "redirect", to: GESTOR_PATH });
  });
  it("admin entra en todo", () => {
    expect(decideAccess({ role: "admin", pathname: "/admin/sync" })).toEqual({ type: "allow" });
    expect(decideAccess({ role: "admin", pathname: GESTOR_PATH })).toEqual({ type: "allow" });
  });
  it("whatsapp sigue confinado", () => {
    expect(decideAccess({ role: "whatsapp", pathname: "/" })).toEqual({ type: "redirect", to: "/whatsapp" });
    expect(decideAccess({ role: "whatsapp", pathname: "/whatsapp" })).toEqual({ type: "allow" });
  });
  it("must_change_password fuerza la pantalla de cambio", () => {
    expect(decideAccess({ role: "sales_manager", pathname: GESTOR_PATH, mustChangePassword: true }))
      .toEqual({ type: "redirect", to: PASSWORD_PATH });
    expect(decideAccess({ role: "sales_manager", pathname: PASSWORD_PATH, mustChangePassword: true }))
      .toEqual({ type: "allow" });
  });
  it("sin flag, la pantalla de cambio no es accesible", () => {
    expect(decideAccess({ role: "admin", pathname: PASSWORD_PATH })).toEqual({ type: "redirect", to: "/" });
  });
});

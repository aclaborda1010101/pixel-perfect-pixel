import { describe, it, expect } from "vitest";
import { decideAccess, canAccessGestor, postPasswordChangePath, GESTOR_PATH, PASSWORD_PATH } from "./access";

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
  it("sales_manager queda confinado a su panel", () => {
    for (const path of ["/", "/edificios", "/propietarios", "/llamadas", "/ajustes", "/comercial", "/comercial/tareas", "/whatsapp", "/oportunidades"]) {
      expect(decideAccess({ role: "sales_manager", pathname: path })).toEqual({ type: "redirect", to: GESTOR_PATH });
    }
  });
  it("sales_manager puede usar su panel, subrutas y logout", () => {
    for (const path of [GESTOR_PATH, `${GESTOR_PATH}/detalle`, "/logout"]) {
      expect(decideAccess({ role: "sales_manager", pathname: path })).toEqual({ type: "allow" });
    }
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
  it("redirección post-cambio depende del rol", () => {
    expect(postPasswordChangePath("sales_manager")).toBe(GESTOR_PATH);
    expect(postPasswordChangePath("admin")).toBe("/");
    expect(postPasswordChangePath("comercial_zona")).toBe("/");
  });
  it("sin flag, la pantalla de cambio no es accesible", () => {
    expect(decideAccess({ role: "admin", pathname: PASSWORD_PATH })).toEqual({ type: "redirect", to: "/" });
  });
});

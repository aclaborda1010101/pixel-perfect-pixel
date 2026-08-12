import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { postPasswordChangePath } from "@/lib/access";
import { FEATURE_FORCE_PASSWORD_EDGE_FN } from "@/lib/featureFlags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function CambiarPasswordObligatorio() {
  const { role } = useCurrentRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pwd.length < 10) return setError("La contraseña debe tener al menos 10 caracteres.");
    if (pwd !== pwd2) return setError("Las contraseñas no coinciden.");
    // FALLA CERRADO: sin el servicio activo NO se toca la contraseña.
    // No existe ruta alternativa desde el navegador (bajar el flag desde el
    // cliente dejaría el acceso abierto sin garantía de cambio real).
    if (!FEATURE_FORCE_PASSWORD_EDGE_FN) {
      return setError(
        "El servicio de cambio de contraseña no está activado. No se ha modificado nada: avisa a soporte.",
      );
    }

    setSaving(true);
    const { data, error: fnErr } = await supabase.functions.invoke("force_password_change", {
      body: { password: pwd },
    });
    setSaving(false);
    if (fnErr) {
      // invoke() oculta el cuerpo de las respuestas no-2xx: lo leemos a mano
      // para poder mostrar el motivo real en lugar de un error genérico.
      let detalle = "";
      try {
        const res = (fnErr as { context?: Response }).context;
        if (res && typeof res.json === "function") {
          const body = await res.clone().json();
          detalle = typeof body?.error === "string" ? body.error : "";
        }
      } catch {
        detalle = "";
      }
      return setError(detalle || fnErr.message);
    }
    if (!data?.ok) {
      return setError(
        data?.error ?? "No se pudo completar el cambio de contraseña. El acceso sigue bloqueado.",
      );
    }

    await queryClient.invalidateQueries({ queryKey: ["mustChangePassword"] });
    toast.success("Contraseña actualizada");
    navigate(postPasswordChangePath(role), { replace: true });
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Cambia tu contraseña</CardTitle>
          <CardDescription>
            Tu cuenta usa una contraseña temporal. Debes establecer una nueva antes de continuar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pwd">Nueva contraseña</Label>
              <Input id="pwd" type="password" value={pwd} autoComplete="new-password"
                onChange={(e) => setPwd(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pwd2">Repite la contraseña</Label>
              <Input id="pwd2" type="password" value={pwd2} autoComplete="new-password"
                onChange={(e) => setPwd2(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Guardando…" : "Guardar y continuar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

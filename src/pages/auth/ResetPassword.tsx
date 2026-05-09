import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthShell } from "./AuthShell";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Supabase intercambia el code/hash automáticamente y dispara onAuthStateChange.
    // Marcamos ready cuando recibimos PASSWORD_RECOVERY o cuando ya hay sesión.
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "PASSWORD_RECOVERY" || evt === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Contraseña actualizada");
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar la contraseña");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <Eyebrow>Panel · Nueva contraseña</Eyebrow>
          <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
            Define tu nueva contraseña
          </h2>
          <p className="text-sm text-muted-foreground">
            Mínimo 8 caracteres. Te llevamos al panel en cuanto la guardes.
          </p>
        </div>

        {!ready ? (
          <div className="rounded-[6px] border border-border bg-surface-1/30 p-5 text-sm text-muted-foreground">
            Validando enlace de recuperación…
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Nueva contraseña
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button variant="gold" className="w-full" size="lg" type="submit" disabled={submitting}>
              {submitting ? "Guardando…" : "Guardar contraseña"}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
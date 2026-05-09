import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthShell } from "./AuthShell";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

type Mode = "signin" | "signup";

export default function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [magicSubmitting, setMagicSubmitting] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [usePassword, setUsePassword] = useState(false);

  useEffect(() => {
    if (session) navigate(from, { replace: true });
  }, [session, from, navigate]);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setMagicSubmitting(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      setMagicSent(true);
      toast.success("Magic link enviado — revisa tu email");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error enviando magic link";
      toast.error(msg);
    } finally {
      setMagicSubmitting(false);
    }
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Sesión iniciada");
      } else {
        const redirectUrl = `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Cuenta creada — revisa tu email para confirmar");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error de autenticación";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/`,
      });
      if (result.error) throw result.error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error con Google";
      toast.error(msg);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <Eyebrow>Panel · Acceso</Eyebrow>
          <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
            Bienvenido a Afflux Property
          </h2>
          <p className="text-sm text-muted-foreground">
            Introduce tu email corporativo y te enviaremos un enlace de acceso seguro.
          </p>
        </div>

        {/* Magic link primary form */}
        <form className="space-y-5" onSubmit={handleMagicLink}>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              Email corporativo
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="alvaro@afflux.es"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setMagicSent(false); }}
              required
            />
          </div>
          <Button variant="gold" className="w-full" size="lg" type="submit" disabled={magicSubmitting || magicSent}>
            {magicSubmitting ? "Enviando…" : magicSent ? "Enlace enviado ✓" : "Enviar magic link"}
          </Button>
          {magicSent && (
            <p className="text-center font-mono text-[11px] uppercase tracking-eyebrow text-gold">
              Revisa tu bandeja · {email}
            </p>
          )}
        </form>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border-faint" />
            <Eyebrow>O continúa con</Eyebrow>
            <div className="h-px flex-1 bg-border-faint" />
          </div>
          <Button variant="outline" type="button" className="w-full" onClick={handleGoogle}>
            Google Workspace
          </Button>
          <button
            type="button"
            onClick={() => setUsePassword((v) => !v)}
            className="block w-full text-center font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground hover:text-gold"
          >
            {usePassword ? "Ocultar acceso por contraseña" : "Acceder con contraseña"}
          </button>
        </div>

        {usePassword && (
        <form className="space-y-5 border-t border-border-faint pt-6" onSubmit={handleEmail}>
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Nombre completo
              </Label>
              <Input id="name" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Contraseña
              </Label>
              {mode === "signin" && (
                <Link to="/recuperar" className="font-mono text-[11px] uppercase tracking-eyebrow text-gold hover:text-gold-strong">
                  ¿Olvidaste tu contraseña?
                </Link>
              )}
            </div>
            <Input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>

          <Button variant="outline" className="w-full" size="lg" type="submit" disabled={submitting}>
            {submitting ? "Procesando…" : mode === "signin" ? "Acceder al panel" : "Crear cuenta"}
          </Button>
          <div className="text-center text-sm text-muted-foreground">
          {mode === "signin" ? (
            <>
              ¿Sin cuenta?{" "}
              <button type="button" onClick={() => setMode("signup")} className="font-mono text-[11px] uppercase tracking-eyebrow text-gold hover:text-gold-strong">
                Crear cuenta
              </button>
            </>
          ) : (
            <>
              ¿Ya tienes cuenta?{" "}
              <button type="button" onClick={() => setMode("signin")} className="font-mono text-[11px] uppercase tracking-eyebrow text-gold hover:text-gold-strong">
                Inicia sesión
              </button>
            </>
          )}
          </div>
        </form>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border-faint pt-6">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground">Afflux Property · Madrid · 2026</span>
        </div>
      </div>
    </AuthShell>
  );
}

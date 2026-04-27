import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AuthShell } from "./AuthShell";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/common/StatusBadge";

export default function RecoverPassword() {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("alvaro@afflux.es");

  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <Eyebrow>Panel · Recuperar acceso</Eyebrow>
          <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
            Recupera tu acceso
          </h2>
          <p className="text-sm text-muted-foreground">
            Sin dramas. Te enviamos un enlace y vuelves al trabajo.
          </p>
        </div>

        {!sent ? (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              setSent(true);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Email corporativo
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <Button variant="gold" className="w-full" size="lg" type="submit">
              Enviar enlace de recuperación
            </Button>
          </form>
        ) : (
          <div className="space-y-4 rounded-[6px] border border-border bg-surface-1/30 p-5">
            <StatusBadge status="done" label="Enlace enviado" />
            <p className="text-sm text-foreground">
              Revisa <span className="font-mono text-gold">{email}</span>.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              El enlace caduca en 30 min
            </p>
          </div>
        )}

        <div className="border-t border-border-faint pt-6">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Volver al login
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}

import { Link } from "react-router-dom";
import { AuthShell } from "./AuthShell";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function Login() {
  return (
    <AuthShell>
      <div className="space-y-8">
        <div className="space-y-2">
          <Eyebrow>Panel · Acceso</Eyebrow>
          <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
            Bienvenido de vuelta
          </h2>
          <p className="text-sm text-muted-foreground">
            Accede al panel para retomar tus cadencias y llamadas.
          </p>
        </div>

        <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
              Email corporativo
            </Label>
            <Input id="email" type="email" placeholder="alvaro@afflux.es" autoComplete="email" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
                Contraseña
              </Label>
              <Link
                to="/recuperar"
                className="font-mono text-[11px] uppercase tracking-eyebrow text-gold hover:text-gold-strong"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <Input id="password" type="password" autoComplete="current-password" />
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox id="remember" />
            <span>Mantener la sesión iniciada</span>
          </label>

          <Button variant="gold" className="w-full" size="lg">
            Acceder al panel
          </Button>
        </form>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border-faint" />
            <Eyebrow>O continúa con</Eyebrow>
            <div className="h-px flex-1 bg-border-faint" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button variant="outline" type="button">Microsoft 365</Button>
            <Button variant="outline" type="button">Google Workspace</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-border-faint pt-6">
          <a href="#" className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground">
            Política de privacidad
          </a>
          <span className="text-muted-foreground/30">·</span>
          <a href="#" className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground">
            Términos
          </a>
          <span className="text-muted-foreground/30">·</span>
          <a href="#" className="font-mono text-[10px] uppercase tracking-eyebrow text-muted-foreground hover:text-foreground">
            Estado del sistema
          </a>
        </div>
      </div>
    </AuthShell>
  );
}

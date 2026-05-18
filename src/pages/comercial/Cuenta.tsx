import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { User, KeyRound, Palette, LogOut, Loader2 } from "lucide-react";

export default function ComercialCuenta() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancel) return;
      setFullName(data?.full_name ?? "");
      setLoadingProfile(false);
    })();
    return () => { cancel = true; };
  }, [user]);

  async function handleSaveProfile() {
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() || null })
      .eq("id", user.id);
    setSavingProfile(false);
    if (error) toast.error("No se pudo guardar: " + error.message);
    else toast.success("Perfil actualizado");
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error("Error: " + error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("Contraseña actualizada");
  }

  async function handleLogout() {
    await signOut();
    toast.success("Sesión cerrada");
    navigate("/login", { replace: true });
  }

  const initials = (fullName || user?.email || "·")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cuenta · Mi perfil"
        title="Mi cuenta"
        subtitle="Gestiona tu perfil, contraseña y preferencias"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Eyebrow><User className="mr-1 inline h-3 w-3" /> Perfil</Eyebrow>
            <CardTitle>Datos personales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/50 bg-surface-1 font-mono text-sm text-primary">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{user?.email}</div>
                <Badge variant="info" className="mt-1">Comercial de zona</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Tu nombre"
                disabled={loadingProfile}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email ?? ""} disabled />
              <p className="text-xs text-muted-foreground">
                Para cambiar el email, contacta con tu administrador.
              </p>
            </div>
            <Button onClick={handleSaveProfile} disabled={savingProfile || loadingProfile} variant="gold">
              {savingProfile && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar cambios
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow><KeyRound className="mr-1 inline h-3 w-3" /> Seguridad</Eyebrow>
            <CardTitle>Cambiar contraseña</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nueva contraseña</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <Button onClick={handleChangePassword} disabled={savingPassword} variant="gold">
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              Actualizar contraseña
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow><Palette className="mr-1 inline h-3 w-3" /> Apariencia</Eyebrow>
            <CardTitle>Tema</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(["light", "dark", "system"] as const).map((th) => (
              <Button
                key={th}
                variant={theme === th ? "gold" : "outline"}
                size="sm"
                onClick={() => setTheme(th)}
              >
                {th === "light" ? "Claro" : th === "dark" ? "Oscuro" : "Sistema"}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Eyebrow><LogOut className="mr-1 inline h-3 w-3" /> Sesión</Eyebrow>
            <CardTitle>Cerrar sesión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Cierra tu sesión en este dispositivo. Tendrás que iniciar sesión de nuevo.
            </p>
            <Button variant="destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
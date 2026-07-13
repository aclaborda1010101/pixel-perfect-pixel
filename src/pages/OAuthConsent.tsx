import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./auth/AuthShell";
import { Eyebrow } from "@/components/common/Eyebrow";

type SupabaseOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function oauth(): SupabaseOAuth {
  return (supabase.auth as unknown as { oauth: SupabaseOAuth }).oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Falta authorization_id en la URL.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message ?? "No se pudo cargar la autorización.");
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Error inesperado.");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const { data, error } = approve
        ? await oauth().approveAuthorization(authorizationId)
        : await oauth().denyAuthorization(authorizationId);
      if (error) {
        setError(error.message ?? "No se pudo completar la decisión.");
        setBusy(false);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setError("El servidor de autorización no devolvió un redirect.");
        setBusy(false);
        return;
      }
      window.location.href = target;
    } catch (e: any) {
      setError(e?.message ?? "Error inesperado.");
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <Eyebrow>Panel · Autorización</Eyebrow>
          <h2 className="font-editorial text-3xl font-normal tracking-notarial text-foreground">
            {details?.client?.name
              ? `Conectar ${details.client.name}`
              : "Autorizar acceso"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Esta aplicación podrá usar las herramientas MCP de Afflux Property
            actuando como tú. Se aplican las mismas políticas de acceso a datos.
          </p>
        </div>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!error && !details && (
          <p className="font-mono text-[11px] uppercase tracking-eyebrow text-muted-foreground">
            Cargando…
          </p>
        )}

        {details && (
          <div className="space-y-4">
            {details.client?.redirect_uri && (
              <div className="rounded border border-border-faint p-3 text-xs">
                <div className="font-mono uppercase tracking-eyebrow text-muted-foreground">
                  Redirect URI
                </div>
                <div className="break-all">{details.client.redirect_uri}</div>
              </div>
            )}
            <div className="flex gap-3">
              <Button
                variant="gold"
                className="flex-1"
                disabled={busy}
                onClick={() => decide(true)}
              >
                {busy ? "Procesando…" : "Aprobar"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={() => decide(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
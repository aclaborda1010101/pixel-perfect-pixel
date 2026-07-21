import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ruta legacy `/llamadas/:id` (id UUID de public.calls).
 * Resuelve el hs_id desde calls.metadatos y redirige al expediente unificado.
 * Si no hay hs_id, vuelve al listado.
 */
export default function CallLegacyRedirect() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      if (!id) return navigate("/llamadas", { replace: true });
      const { data } = await supabase.from("calls").select("metadatos").eq("id", id).maybeSingle();
      const hsId = (data as any)?.metadatos?.hs_id ?? (data as any)?.metadatos?.hubspot_id ?? null;
      if (hsId) navigate(`/comercial/llamada/${hsId}`, { replace: true });
      else navigate("/llamadas", { replace: true });
    })();
  }, [id, navigate]);
  return (
    <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
      Abriendo expediente…
    </div>
  );
}
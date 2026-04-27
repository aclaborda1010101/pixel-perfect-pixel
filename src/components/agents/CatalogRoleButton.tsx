import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Tags } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/I18nProvider";
import { toast } from "sonner";

export function CatalogRoleButton({ ownerId, onDone }: { ownerId: string; onDone?: () => void }) {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ rol: string; confianza: number; justificacion: string } | null>(null);

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_catalog_role", {
        body: { owner_id: ownerId, locale },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult((data as any).result);
      toast.success("Rol actualizado");
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4 text-primary" /> {t.agents.catalogRoleTitle}
        </CardTitle>
        <Button size="sm" onClick={run} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {t.agents.catalogRoleRun}
        </Button>
      </CardHeader>
      {result && (
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge>{result.rol}</Badge>
            <span className="text-xs text-muted-foreground">
              {(result.confianza * 100).toFixed(0)}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{result.justificacion}</div>
        </CardContent>
      )}
    </Card>
  );
}
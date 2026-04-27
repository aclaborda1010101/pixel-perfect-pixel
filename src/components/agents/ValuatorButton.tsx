import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Calculator } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n/I18nProvider";
import { toast } from "sonner";

export function ValuatorButton({ assetId, onDone }: { assetId: string; onDone?: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("agent_mock_valuator", {
        body: { asset_id: assetId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const r = (data as any).result;
      toast.success(`Valoración: ${Number(r.valor).toLocaleString()} € (${(r.confianza * 100).toFixed(0)}%)`);
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally { setLoading(false); }
  };
  return (
    <Button size="sm" variant="outline" onClick={run} disabled={loading}>
      {loading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Calculator className="mr-2 h-3 w-3" />}
      {t.agents.valuatorRun}
    </Button>
  );
}
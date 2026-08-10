import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  SALES_TASK_GROUPS,
  SALES_TASK_MODES,
  emptyWeights,
  validateWeights,
  type SalesTaskGroupCode,
  type SalesTaskModeCode,
  type WeightMap,
} from "@/lib/salesTaskModes";
import { useSalesTaskModeConfig } from "@/hooks/useSalesManagerDashboard";

export function ModosTareasCard() {
  const qc = useQueryClient();
  const cfgQ = useSalesTaskModeConfig();
  const [mode, setMode] = useState<SalesTaskModeCode>("equilibrado");
  const [weights, setWeights] = useState<WeightMap>(emptyWeights());
  const [saving, setSaving] = useState(false);

  const activeMode = cfgQ.data?.active?.mode_code as SalesTaskModeCode | undefined;
  const modeDef = SALES_TASK_MODES.find((m) => m.code === mode)!;

  useEffect(() => {
    const saved = cfgQ.data?.modes?.find((m: any) => m.code === mode)?.weights as WeightMap | undefined;
    setWeights({ ...emptyWeights(), ...(saved ?? {}) });
  }, [mode, cfgQ.data]);

  const validation = useMemo(() => validateWeights(weights), [weights]);
  const puedeGuardar = modeDef.followsEngineDefault || validation.valid;

  const setWeight = (code: SalesTaskGroupCode, raw: string) => {
    const n = raw === "" ? 0 : Number.parseInt(raw, 10);
    setWeights((w) => ({ ...w, [code]: Number.isFinite(n) ? n : 0 }));
  };

  const guardar = async (activar: boolean) => {
    setSaving(true);
    const { error } = await (supabase.rpc as any)("set_sales_task_mode", {
      p_mode_code: mode,
      p_weights: modeDef.followsEngineDefault ? null : weights,
      p_target_user: null,
      p_activate: activar,
      p_note: null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(activar ? "Modo activado para tareas futuras" : "Pesos guardados");
    qc.invalidateQueries({ queryKey: ["sales-task-mode-config"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Modo de reparto de tareas</CardTitle>
        <CardDescription>
          El cambio afecta <strong>sólo a tareas futuras</strong>: las ya asignadas no se tocan.
          Si la configuración es inválida o falta, se conserva el comportamiento actual del motor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {SALES_TASK_MODES.map((m) => (
            <Button
              key={m.code}
              size="sm"
              variant={mode === m.code ? "default" : "outline"}
              onClick={() => setMode(m.code)}
            >
              {m.label}
              {activeMode === m.code && <Badge className="ml-2" variant="secondary">Activo</Badge>}
            </Button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{modeDef.description}</p>

        {!modeDef.followsEngineDefault && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {SALES_TASK_GROUPS.map((g) => (
                <label key={g.code} className="flex items-center justify-between gap-3 rounded-md border p-2">
                  <span className="text-xs">
                    {g.label}
                    {!g.enabled && <span className="ml-1 text-muted-foreground">(peso fijo 0)</span>}
                  </span>
                  <Input
                    className="h-8 w-20 text-right tabular-nums"
                    type="number"
                    min={0}
                    max={100}
                    disabled={!g.enabled}
                    value={String(weights[g.code] ?? 0)}
                    onChange={(e) => setWeight(g.code, e.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md border p-2 text-sm">
              <span>Total</span>
              <span
                className={
                  validation.total === 100
                    ? "font-semibold tabular-nums"
                    : "font-semibold tabular-nums text-destructive"
                }
              >
                {validation.total}%
              </span>
            </div>

            {validation.errors.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-destructive">
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!puedeGuardar || saving} onClick={() => guardar(false)}>
            Guardar pesos
          </Button>
          <Button size="sm" disabled={!puedeGuardar || saving} onClick={() => guardar(true)}>
            Guardar y activar
          </Button>
        </div>

        {cfgQ.data?.active && (
          <p className="text-[11px] text-muted-foreground">
            Última modificación: {new Date(cfgQ.data.active.updated_at).toLocaleString("es-ES")}
          </p>
        )}

        {Array.isArray(cfgQ.data?.audit) && cfgQ.data.audit.length > 0 && (
          <div className="rounded-md border p-2">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Historial</div>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {cfgQ.data.audit.slice(0, 5).map((a: any) => (
                <li key={a.id}>
                  {new Date(a.created_at).toLocaleString("es-ES")} · {a.mode_code} · {a.scope}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

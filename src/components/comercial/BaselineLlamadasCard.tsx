import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";

type Row = { hs_owner_id: string | null; b0_15: number; b15_45: number; b45_90: number; b90: number; total: number; pct_over_60: number };

export function BaselineLlamadasCard({ weeks = 12 }: { weeks?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [owners, setOwners] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate() - weeks * 7);
    supabase
      .from("calls")
      .select("comercial_hs_id, comercial_nombre, duracion_seg")
      .gte("fecha", since.toISOString())
      .limit(5000)
      .then(({ data }) => {
        const map = new Map<string, Row>();
        const names = new Map<string, string>();
        for (const c of (data as any[]) || []) {
          const oid = c.comercial_hs_id || "—";
          if (c.comercial_nombre) names.set(oid, c.comercial_nombre);
          const d = Number(c.duracion_seg ?? 0);
          const r = map.get(oid) || { hs_owner_id: oid, b0_15: 0, b15_45: 0, b45_90: 0, b90: 0, total: 0, pct_over_60: 0 };
          r.total += 1;
          if (d < 15) r.b0_15 += 1;
          else if (d < 45) r.b15_45 += 1;
          else if (d < 90) r.b45_90 += 1;
          else r.b90 += 1;
          if (d >= 60) r.pct_over_60 += 1;
          map.set(oid, r);
        }
        const arr = Array.from(map.values()).map((r) => ({ ...r, pct_over_60: r.total ? (r.pct_over_60 / r.total) * 100 : 0 }));
        arr.sort((a, b) => b.total - a.total);
        setRows(arr);
        setOwners(names);
      });
  }, [weeks]);

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Baseline · pre-sistema F3</Eyebrow>
        <CardTitle>Llamadas últimas {weeks} semanas · histograma de duración</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b">
              <tr>
                <th className="py-2">Comercial</th>
                <th>Total</th>
                <th>0-15s</th>
                <th>15-45s</th>
                <th>45-90s</th>
                <th>+90s</th>
                <th>% &gt;1min</th>
                <th>Distribución</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const max = Math.max(1, r.total);
                return (
                  <tr key={r.hs_owner_id || "x"} className="border-b border-border-faint">
                    <td className="py-2 truncate max-w-[180px]">{owners.get(r.hs_owner_id || "") || r.hs_owner_id || "—"}</td>
                    <td className="font-mono">{r.total}</td>
                    <td className="font-mono">{r.b0_15}</td>
                    <td className="font-mono">{r.b15_45}</td>
                    <td className="font-mono">{r.b45_90}</td>
                    <td className="font-mono">{r.b90}</td>
                    <td className="font-mono text-gold">{r.pct_over_60.toFixed(0)}%</td>
                    <td className="w-[200px]">
                      <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
                        <div className="bg-destructive" style={{ width: `${(r.b0_15 / max) * 100}%` }} />
                        <div className="bg-warning" style={{ width: `${(r.b15_45 / max) * 100}%` }} />
                        <div className="bg-info" style={{ width: `${(r.b45_90 / max) * 100}%` }} />
                        <div className="bg-success" style={{ width: `${(r.b90 / max) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-muted-foreground">Sin llamadas en el rango.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
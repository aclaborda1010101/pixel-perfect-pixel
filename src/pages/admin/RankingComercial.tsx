import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/common/PageHeader";
import { Eyebrow } from "@/components/common/Eyebrow";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, TrendingUp } from "lucide-react";

export default function RankingComercial() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin:ranking"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("v_kpis_comercial_semana" as any) as any)
        .select("*")
        .order("semana", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as any[];
    },
  });

  const rows = data ?? [];
  const semanas = Array.from(new Set(rows.map((r) => r.semana))).sort().reverse();
  const semanaActiva = semanas[0];
  const ranking = rows
    .filter((r) => r.semana === semanaActiva)
    .sort((a, b) => Number(b.calidad_media ?? 0) - Number(a.calidad_media ?? 0));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Ranking comercial"
        title="KPIs semanales por comercial"
        subtitle="Llamadas, calidad técnica y conversiones a partir de calls.duracion_seg, tecnica_score y outcome."
      />

      <Card>
        <CardHeader>
          <Eyebrow><Trophy className="mr-1 inline h-3 w-3 text-gold" /> Semana {semanaActiva ?? "—"}</Eyebrow>
          <CardTitle>Ranking actual</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Comercial</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">% &gt;1 min</TableHead>
                <TableHead className="text-right">Calidad</TableHead>
                <TableHead className="text-right">Interesados</TableHead>
                <TableHead className="text-right">Seguimientos</TableHead>
                <TableHead className="text-right">Reuniones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">{isLoading ? "Cargando…" : "Sin datos esta semana"}</TableCell></TableRow>
              )}
              {ranking.map((r, i) => (
                <TableRow key={r.comercial_key}>
                  <TableCell className="font-mono">{i + 1}</TableCell>
                  <TableCell className="font-medium">{r.comercial_nombre}</TableCell>
                  <TableCell className="text-right font-mono">{r.llamadas_total}</TableCell>
                  <TableCell className="text-right font-mono">
                    <Badge variant={Number(r.pct_mayor_1min ?? 0) >= 30 ? "success" : "outline"}>{r.pct_mayor_1min ?? 0}%</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-gold">{r.calidad_media ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.interesados}</TableCell>
                  <TableCell className="text-right font-mono">{r.seguimientos}</TableCell>
                  <TableCell className="text-right font-mono">{r.reuniones_cerradas}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Eyebrow><TrendingUp className="mr-1 inline h-3 w-3" /> Histórico (12 sem)</Eyebrow>
          <CardTitle>Todas las semanas</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Semana</TableHead>
                <TableHead>Comercial</TableHead>
                <TableHead className="text-right">Llamadas</TableHead>
                <TableHead className="text-right">Dur. media</TableHead>
                <TableHead className="text-right">% &gt;1min</TableHead>
                <TableHead className="text-right">Calidad</TableHead>
                <TableHead className="text-right">WApp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.semana}-${r.comercial_key}`}>
                  <TableCell className="font-mono text-xs">{r.semana}</TableCell>
                  <TableCell>{r.comercial_nombre}</TableCell>
                  <TableCell className="text-right font-mono">{r.llamadas_total}</TableCell>
                  <TableCell className="text-right font-mono">{r.duracion_media_seg ?? 0}s</TableCell>
                  <TableCell className="text-right font-mono">{r.pct_mayor_1min ?? 0}%</TableCell>
                  <TableCell className="text-right font-mono">{r.calidad_media ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{r.whatsapp_enviados}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
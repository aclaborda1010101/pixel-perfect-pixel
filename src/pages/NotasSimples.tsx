import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, AlertTriangle, CheckCircle2, Clock, Plus } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNotasSimples, type NotaSimpleEnriched } from "@/hooks/useNotasSimples";
import { UploadNotaSimpleDialog } from "@/components/notas/UploadNotaSimpleDialog";

function StatusChip({ status }: { status: string }) {
  if (status === "procesando")
    return <Badge variant="info"><Loader2 className="h-3 w-3 animate-spin mr-1" />procesando</Badge>;
  if (status === "listo")
    return <Badge variant="success"><CheckCircle2 className="h-3 w-3 mr-1" />listo</Badge>;
  if (status === "error")
    return <Badge variant="danger"><AlertTriangle className="h-3 w-3 mr-1" />error</Badge>;
  return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />pendiente</Badge>;
}

function RiesgoBadge({ r }: { r: string | null }) {
  if (!r) return <span className="text-muted-foreground text-xs">—</span>;
  const v = r === "alto" ? "danger" : r === "medio" ? "warning" : "success";
  return <Badge variant={v as any}>{r}</Badge>;
}

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" }); }
  catch { return d; }
}

export default function NotasSimples() {
  const { items, loading } = useNotasSimples();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Captación"
        title="Notas Simples"
        subtitle="Sube notas del Registro y extrae titulares, cargas y nivel de riesgo."
        actions={undefined as any}
      />
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Solicitar nota simple
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={FileText} title="Sin notas todavía"
          description="Sube tu primera nota simple para empezar." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Edificio</TableHead>
                  <TableHead>Propietario</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Riesgo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((n: NotaSimpleEnriched) => (
                  <TableRow key={n.id} className="cursor-pointer"
                    onClick={() => navigate(`/notas-simples/${n.id}`)}>
                    <TableCell className="font-medium">
                      {n.building?.direccion ?? <span className="text-muted-foreground">— sin asignar —</span>}
                      {n.building?.ciudad && <div className="text-xs text-muted-foreground">{n.building.ciudad}</div>}
                    </TableCell>
                    <TableCell>{n.owner?.nombre ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(n.created_at)}</TableCell>
                    <TableCell><StatusChip status={n.status} /></TableCell>
                    <TableCell><RiesgoBadge r={n.riesgo} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <UploadNotaSimpleDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

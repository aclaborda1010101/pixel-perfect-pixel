import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotasSimples } from "@/hooks/useNotasSimples";
import { toast } from "sonner";

type Match = { id: string; direccion: string; ciudad: string | null };

export function NewBuildingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const { upload } = useNotasSimples();
  const [direccion, setDireccion] = useState("");
  const [ciudad, setCiudad] = useState("Madrid");
  const [refCat, setRefCat] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setDireccion(""); setCiudad("Madrid"); setRefCat(""); setFile(null); setMatches([]);
    }
  }, [open]);

  // Autocomplete contra buildings (anti-duplicado)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = direccion.trim();
    if (q.length < 3) { setMatches([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      const { data } = await supabase
        .from("buildings")
        .select("id, direccion, ciudad")
        .ilike("direccion", `%${q}%`)
        .limit(5);
      setMatches((data ?? []) as Match[]);
    }, 250);
  }, [direccion]);

  const crear = async () => {
    const dir = direccion.trim();
    if (!dir) { toast.error("Dirección obligatoria"); return; }
    if (!file) { toast.error("Sube la nota simple PDF"); return; }
    setBusy(true);
    try {
      const { data: b, error } = await supabase
        .from("buildings")
        .insert({
          direccion: dir,
          ciudad: ciudad.trim() || null,
          refcatastral: refCat.trim() || null,
          estado: "activo" as any,
        })
        .select("id")
        .single();
      if (error || !b) throw new Error(error?.message ?? "No se pudo crear edificio");

      // Sube nota simple → analyze_nota_simple se lanza solo
      await upload(file, b.id, null);

      toast.success("Edificio creado. Procesando nota simple…");
      onOpenChange(false);
      navigate(`/comercial/edificios/${b.id}`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Dar de alta nuevo edificio
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Dirección *</Label>
            <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle Ambros 28" />
            {matches.length > 0 && (
              <div className="mt-2 space-y-1 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <div className="text-amber-400">Ya existen edificios parecidos:</div>
                {matches.map(m => (
                  <button
                    key={m.id}
                    className="flex w-full items-center justify-between rounded px-2 py-1 hover:bg-amber-500/10"
                    onClick={() => { onOpenChange(false); navigate(`/comercial/edificios/${m.id}`); }}
                  >
                    <span>{m.direccion}</span>
                    <Badge variant="outline" className="text-[10px]">{m.ciudad ?? "—"}</Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Ciudad</Label>
              <Input value={ciudad} onChange={(e) => setCiudad(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ref. catastral (opcional)</Label>
              <Input value={refCat} onChange={(e) => setRefCat(e.target.value)} placeholder="XXXXXXXXNXXXXX" />
            </div>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1"><FileText className="h-3 w-3" /> Nota simple (PDF) *</Label>
            <Input type="file" accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tras subir, se extraen titulares y se lanza el pipeline (datoscif → Inglobaly → verificación → HubSpot).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button variant="gold" onClick={crear} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Crear y procesar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
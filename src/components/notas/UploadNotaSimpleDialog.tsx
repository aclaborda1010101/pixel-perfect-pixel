import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNotasSimples } from "@/hooks/useNotasSimples";

type Building = { id: string; direccion: string; ciudad: string | null };
type Owner = { id: string; nombre: string };

export function UploadNotaSimpleDialog({
  open, onOpenChange, defaultBuildingId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultBuildingId?: string | null;
}) {
  const { upload } = useNotasSimples();
  const [search, setSearch] = useState("");
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState<string | null>(defaultBuildingId ?? null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Search edificios por dirección
  useEffect(() => {
    let cancelled = false;
    const q = search.trim();
    if (q.length < 2 && !defaultBuildingId) { setBuildings([]); return; }
    (async () => {
      const query = supabase.from("buildings").select("id, direccion, ciudad").limit(15);
      const { data } = q.length >= 2
        ? await query.ilike("direccion", `%${q}%`)
        : await query.eq("id", defaultBuildingId!);
      if (!cancelled) setBuildings((data ?? []) as Building[]);
    })();
    return () => { cancelled = true; };
  }, [search, defaultBuildingId]);

  // Owners vinculados al edificio seleccionado
  useEffect(() => {
    if (!buildingId) { setOwners([]); return; }
    (async () => {
      const { data: links } = await supabase
        .from("building_owners")
        .select("owner_id")
        .eq("building_id", buildingId);
      const ids = (links ?? []).map((l: any) => l.owner_id).filter(Boolean);
      if (ids.length === 0) { setOwners([]); return; }
      const { data: ows } = await supabase
        .from("owners").select("id, nombre").in("id", ids).limit(50);
      setOwners((ows ?? []) as Owner[]);
    })();
  }, [buildingId]);

  const reset = () => {
    setSearch(""); setBuildings([]); setBuildingId(defaultBuildingId ?? null);
    setOwners([]); setOwnerId(null); setFile(null); setBusy(false);
  };

  const onSubmit = async () => {
    if (!file) { toast.error("Selecciona un PDF"); return; }
    setBusy(true);
    try {
      const id = await upload(file, buildingId, ownerId);
      toast.success("Nota subida — analizando…");
      onOpenChange(false);
      reset();
      return id;
    } catch (e: any) {
      toast.error(e?.message ?? "Error");
    } finally {
      setBusy(false);
    }
  };

  const selectedBuilding = useMemo(
    () => buildings.find(b => b.id === buildingId) ?? null,
    [buildings, buildingId],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Solicitar nota simple</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Edificio</Label>
            <Input
              placeholder="Buscar por dirección…"
              value={selectedBuilding ? `${selectedBuilding.direccion} · ${selectedBuilding.ciudad ?? ""}` : search}
              onChange={(e) => { setBuildingId(null); setSearch(e.target.value); }}
            />
            {!buildingId && buildings.length > 0 && (
              <div className="border border-border rounded max-h-44 overflow-auto text-sm">
                {buildings.map(b => (
                  <button key={b.id}
                    className="block w-full text-left px-3 py-2 hover:bg-surface-1/40"
                    onClick={() => { setBuildingId(b.id); setSearch(""); }}>
                    <div className="font-medium truncate">{b.direccion}</div>
                    <div className="text-xs text-muted-foreground">{b.ciudad}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {buildingId && (
            <div className="space-y-2">
              <Label>Propietario (opcional)</Label>
              {owners.length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin propietarios vinculados a este edificio.</div>
              ) : (
                <select
                  className="w-full h-9 rounded-[6px] border border-border bg-background px-3 text-sm"
                  value={ownerId ?? ""}
                  onChange={(e) => setOwnerId(e.target.value || null)}>
                  <option value="">— Sin asignar —</option>
                  {owners.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Archivo PDF</Label>
            <label className="flex items-center justify-center gap-2 border border-dashed border-border rounded-md p-5 cursor-pointer hover:bg-surface-1/30">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {file ? file.name : "Selecciona o arrastra un PDF"}
              </span>
              <input type="file" accept="application/pdf" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={onSubmit} disabled={busy || !file}>
            {busy && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Analizar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}